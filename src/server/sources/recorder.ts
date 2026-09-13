/**
 * Raw packet recordings (.ams2rec): record on the gaming PC, replay anywhere.
 *
 * Format (gzip-compressed):
 *   "AMS2REC1"                      8-byte magic
 *   repeated: u32 LE  ms since start
 *             u16 LE  packet length
 *             bytes   the UDP payload, untouched
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createGzip, constants as zlib } from 'node:zlib';

export const RECORDING_MAGIC = 'AMS2REC1';

export class PacketRecorder {
  readonly path: string;
  private readonly gzip = createGzip();
  private readonly output;
  private readonly flushTimer: ReturnType<typeof setInterval>;
  private startedAt: number | null = null;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.output = createWriteStream(path);
    this.gzip.pipe(this.output);
    this.gzip.write(Buffer.from(RECORDING_MAGIC, 'ascii'));
    // Flush regularly so a crash loses seconds, not the session.
    this.flushTimer = setInterval(() => this.gzip.flush(zlib.Z_SYNC_FLUSH), 5000);
    this.flushTimer.unref();
  }

  write(bytes: Uint8Array, at: number): void {
    this.startedAt ??= at;
    const head = Buffer.alloc(6);
    head.writeUInt32LE(Math.max(0, at - this.startedAt), 0);
    head.writeUInt16LE(bytes.byteLength, 4);
    this.gzip.write(head);
    this.gzip.write(bytes);
  }

  close(): Promise<void> {
    clearInterval(this.flushTimer);
    return new Promise((resolve) => {
      this.output.once('finish', () => resolve());
      this.gzip.end();
    });
  }
}
