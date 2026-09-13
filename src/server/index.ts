/**
 * AMS2 Telemetry Coach: command-line entry point.
 *
 *   npm start                      listen for the game on UDP 5606
 *   npm run demo                   simulated driver, no game needed
 *   npm run replay -- file.ams2rec replay a recording
 *
 * Run with --help for every option.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ViteDevServer } from 'vite';
import type { SourceKind, SourceStatus } from '../shared/model/types.ts';
import { DEFAULT_UDP_PORT } from '../shared/protocol/constants.ts';
import { AnalysisService } from './analysis-service.ts';
import { DemoSimulator } from './demo/simulator.ts';
import { createRequestHandler } from './http.ts';
import { LiveCoach } from './live-coach.ts';
import { attachLiveSocket } from './live-socket.ts';
import { RecordingManager } from './recordings.ts';
import { SessionManager } from './session-manager.ts';
import { startReplay } from './sources/replay.ts';
import { startUdpSource } from './sources/udp.ts';
import { SessionStore } from './storage.ts';
import { TelemetryHub } from './telemetry/hub.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

const HELP = `
AMS2 Telemetry Coach ${version}

Usage: npm start -- [options]

Sources
  --source <udp|demo|replay>  Where telemetry comes from (default: udp)
  --udp-port <port>           UDP port AMS2 sends to (default: ${DEFAULT_UDP_PORT})
  --file <path>               Recording to replay (with --source replay)
  --speed <n>                 Playback speed for demo/replay (default: 1)
  --loop                      Loop the replay
  --prefill <laps>            Demo: simulate this many laps instantly before going live
  --record                    Start recording raw packets immediately
                              (you can also press Record in the dashboard)
  --recordings <dir>          Where recordings are saved (default: ./recordings)

Dashboard
  --port <port>               HTTP port for the dashboard (default: 8606)
  --host <address>            Interface to serve on (default: 127.0.0.1;
                              use 0.0.0.0 to view from a tablet or laptop)
  --rate <fps>                Live updates per second (default: 20)
  --data <dir>                Where sessions are stored (default: ./data)
  --open                      Open the dashboard in your browser
  --dev                       Development mode with hot reload
  -h, --help                  Show this help
`;

const { values } = parseArgs({
  options: {
    source: { type: 'string', short: 's', default: 'udp' },
    'udp-port': { type: 'string', default: String(DEFAULT_UDP_PORT) },
    file: { type: 'string', short: 'f' },
    speed: { type: 'string', default: '1' },
    loop: { type: 'boolean', default: false },
    prefill: { type: 'string', default: '0' },
    record: { type: 'boolean', default: false },
    recordings: { type: 'string', default: join(ROOT, 'recordings') },
    port: { type: 'string', short: 'p', default: '8606' },
    host: { type: 'string', default: '127.0.0.1' },
    rate: { type: 'string', default: '20' },
    data: { type: 'string', default: join(ROOT, 'data') },
    open: { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

function fail(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

const source = values.source as SourceKind;
if (!['udp', 'demo', 'replay'].includes(source)) fail(`Unknown source "${values.source}". Use udp, demo or replay.`);
const port = Number(values.port);
const udpPort = Number(values['udp-port']);
const speed = Math.max(0.1, Number(values.speed) || 1);
const frameRate = Math.min(60, Math.max(1, Number(values.rate) || 20));
const dataDir = resolve(values.data!);

const store = new SessionStore(dataDir);
const analysis = new AnalysisService(store);
const hub = new TelemetryHub();
const manager = new SessionManager(hub, store, analysis, source);
const coach = new LiveCoach(manager, analysis);

const recordings = new RecordingManager({
  dir: resolve(values.recordings!),
  settingsFile: join(dataDir, 'settings.json'),
  appVersion: version,
  priming: () => hub.primingPackets(),
  context: () => ({
    track: hub.context.track ? [hub.context.track.location, hub.context.track.variation].filter(Boolean).join(' ') : null,
    car: hub.context.car || null,
    sessionId: manager.session?.id ?? null,
  }),
});
if (values.record) recordings.start();
// Re-recording a replay would only duplicate the file you're playing.
if (source !== 'replay') manager.onSession((session) => void recordings.sessionChanged(session.id));
setInterval(() => recordings.idleCheck(), 5000).unref();

const ingest = (bytes: Uint8Array, at: number = Date.now()) => {
  recordings.write(bytes, at);
  hub.ingest(bytes, at);
};

let sourceDetail = '';
let stopSource = () => {};

switch (source) {
  case 'udp': {
    sourceDetail = `Listening for Automobilista 2 on UDP port ${udpPort}`;
    const udp = startUdpSource({
      port: udpPort,
      onPacket: ingest,
      onError: (error) => {
        if (error.code === 'EADDRINUSE') {
          fail(`UDP port ${udpPort} is already in use by another program. Close it or pass --udp-port.`);
        }
        console.error('UDP error:', error.message);
      },
    });
    stopSource = udp.close;
    break;
  }
  case 'demo': {
    const demo = new DemoSimulator(ingest, { speed });
    const prefill = Math.max(0, Math.floor(Number(values.prefill) || 0));
    if (prefill > 0) {
      console.log(`  Simulating ${prefill} laps…`);
      demo.runLaps(prefill);
    }
    demo.start();
    sourceDetail = `Demo driver at ${demo.track.location} (${speed}× speed)`;
    stopSource = () => demo.stop();
    break;
  }
  case 'replay': {
    const file = values.file ?? fail('Replay needs a recording: npm run replay -- recordings/your-file.ams2rec');
    if (!existsSync(file)) fail(`Recording not found: ${file}`);
    sourceDetail = `Replaying ${file} (${speed}× speed${values.loop ? ', looping' : ''})`;
    const replay = startReplay({
      file,
      speed,
      loop: values.loop!,
      onPacket: ingest,
      onEnd: () => console.log('  Replay finished. The dashboard stays up so you can review the laps.'),
      onError: (error) => console.error('Replay error:', error.message),
    });
    stopSource = replay.close;
    break;
  }
}

const status = (): SourceStatus => ({
  source,
  detail: sourceDetail,
  packetsPerSecond: hub.packetsPerSecond,
  packetCounts: hub.packetCounts,
  lastPacketAt: hub.lastPacketAt,
  recording: recordings.status,
});

const server = createServer();
let vite: ViteDevServer | undefined;
if (values.dev) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    configFile: join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
} else if (!existsSync(join(ROOT, 'dist', 'web', 'index.html'))) {
  console.log('  Building the dashboard (first run only)…');
  const { build } = await import('vite');
  await build({ configFile: join(ROOT, 'vite.config.ts'), logLevel: 'warn' });
}

server.on(
  'request',
  createRequestHandler({
    store,
    analysis,
    manager,
    recordings,
    status,
    version,
    staticDir: join(ROOT, 'dist', 'web'),
    vite,
  }),
);
const live = attachLiveSocket(server, { manager, hub, coach, status, version, frameRate });

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') fail(`Port ${port} is already in use. Try: npm start -- --port ${port + 1}`);
  fail(error.message);
});

server.listen(port, values.host, () => {
  const local = `http://localhost:${port}`;
  const lines = ['', `  AMS2 Telemetry Coach ${version}`, '', `  Dashboard   ${local}`];
  if (values.host === '0.0.0.0') {
    for (const address of Object.values(networkInterfaces()).flat()) {
      if (address && address.family === 'IPv4' && !address.internal) lines.push(`              http://${address.address}:${port}`);
    }
  }
  lines.push(`  Source      ${sourceDetail}`);
  lines.push(`  Sessions    ${store.root}`);
  lines.push(`  Recordings  ${recordings.dir}${recordings.status ? ' (recording now)' : recordings.autoRecord ? ' (recording every session)' : ''}`);
  if (source === 'udp') {
    lines.push('', '  In AMS2: Options → System → UDP Frequency 1, UDP Protocol Version "Project CARS 2"');
  }
  lines.push('', '  Press Ctrl+C to stop.', '');
  console.log(lines.join('\n'));
  if (values.open) openBrowser(local);
});

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n  Stopping…');
  stopSource();
  live.close();
  server.close();
  const saved = await recordings.stop();
  if (saved) console.log(`  Saved recording ${saved.name}`);
  await vite?.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
