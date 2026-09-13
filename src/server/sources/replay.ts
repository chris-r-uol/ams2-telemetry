import { createReadStream } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createGunzip } from 'node:zlib';
import { RECORDING_MAGIC } from './recorder.ts';

export interface RecordedPacket {
  offsetMs: number;
  bytes: Uint8Array;
}

/** Stream packets out of a .ams2rec file without loading it all into memory. */
export async function* readRecording(file: string): AsyncGenerator<RecordedPacket> {
  const stream = createReadStream(file).pipe(createGunzip());
  let buffer: Buffer = Buffer.alloc(0);
  let headerRead = false;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    let offset = 0;
    if (!headerRead) {
      if (buffer.length < RECORDING_MAGIC.length) continue;
      if (buffer.toString('ascii', 0, RECORDING_MAGIC.length) !== RECORDING_MAGIC) {
        throw new Error(`${file} is not an AMS2 telemetry recording`);
      }
      offset = RECORDING_MAGIC.length;
      headerRead = true;
    }
    while (buffer.length - offset >= 6) {
      const offsetMs = buffer.readUInt32LE(offset);
      const length = buffer.readUInt16LE(offset + 4);
      if (buffer.length - offset - 6 < length) break;
      yield { offsetMs, bytes: new Uint8Array(buffer.subarray(offset + 6, offset + 6 + length)) };
      offset += 6 + length;
    }
    buffer = buffer.subarray(offset);
  }
}

export interface ReplayOptions {
  file: string;
  speed: number;
  loop: boolean;
  onPacket: (bytes: Uint8Array, at: number) => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

/** Replay a recording with its original timing, scaled by `speed`. */
export function startReplay(options: ReplayOptions): { close(): void } {
  let stopped = false;
  const run = async () => {
    do {
      const startedAt = performance.now();
      for await (const { offsetMs, bytes } of readRecording(options.file)) {
        if (stopped) return;
        const wait = startedAt + offsetMs / options.speed - performance.now();
        if (wait > 4) await sleep(wait);
        options.onPacket(bytes, Date.now());
      }
    } while (options.loop && !stopped);
    options.onEnd?.();
  };
  run().catch((error: Error) => options.onError?.(error));
  return {
    close: () => {
      stopped = true;
    },
  };
}
