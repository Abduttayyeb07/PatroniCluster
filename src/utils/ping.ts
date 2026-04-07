import * as net from "node:net";
import { logger } from "./logger.js";

export interface PingResult {
  host: string;
  port: number;
  ok: boolean;
  latencyMs: number;
}

/**
 * TCP-connect ping to a host:port.
 * Returns whether the host is reachable and the connection latency in ms.
 * Timeout defaults to 5 seconds.
 */
export function tcpPing(
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<PingResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      const latencyMs = Math.round(performance.now() - start);
      cleanup();
      resolve({ host, port, ok: true, latencyMs });
    });

    socket.on("timeout", () => {
      cleanup();
      logger.debug({ host, port }, "TCP ping timed out");
      resolve({ host, port, ok: false, latencyMs: -1 });
    });

    socket.on("error", (err: Error) => {
      cleanup();
      logger.debug({ host, port, err: err.message }, "TCP ping failed");
      resolve({ host, port, ok: false, latencyMs: -1 });
    });

    socket.connect(port, host);
  });
}
