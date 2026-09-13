import dgram from 'node:dgram';

export interface UdpSourceOptions {
  port: number;
  host?: string;
  onPacket: (bytes: Uint8Array, at: number) => void;
  onListening?: () => void;
  onError?: (error: NodeJS.ErrnoException) => void;
}

/**
 * Listen for AMS2's UDP broadcast. `reuseAddr` lets this run alongside other
 * tools (SimHub, CrewChief, dashboards) that listen on the same port.
 */
export function startUdpSource(options: UdpSourceOptions): { close(): void } {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('message', (message) => {
    options.onPacket(new Uint8Array(message.buffer, message.byteOffset, message.byteLength), Date.now());
  });
  socket.on('error', (error) => options.onError?.(error));
  socket.on('listening', () => options.onListening?.());
  socket.bind(options.port, options.host ?? '0.0.0.0');
  return {
    close: () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}
