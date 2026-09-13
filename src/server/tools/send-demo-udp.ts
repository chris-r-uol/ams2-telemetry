/**
 * Send simulated AMS2 packets over real UDP, to test the UDP listener (or
 * another telemetry tool) without the game.
 *
 *   npm run demo:send-udp -- --host 127.0.0.1 --port 5606 --speed 2
 */
import dgram from 'node:dgram';
import { parseArgs } from 'node:util';
import { DEFAULT_UDP_PORT } from '../../shared/protocol/constants.ts';
import { DemoSimulator } from '../demo/simulator.ts';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: String(DEFAULT_UDP_PORT) },
    speed: { type: 'string', default: '1' },
  },
});

const port = Number(values.port);
const speed = Number(values.speed) || 1;
const socket = dgram.createSocket('udp4');
const demo = new DemoSimulator((bytes) => socket.send(bytes, port, values.host), { speed });
demo.start();

console.log(`Sending simulated AMS2 UDP packets to ${values.host}:${port} at ${speed}× speed. Ctrl+C to stop.`);
process.on('SIGINT', () => {
  demo.stop();
  socket.close();
  process.exit(0);
});
