import net from "node:net";
import { Client } from "ssh2";
import { readFileSync } from "node:fs";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface TunnelOptions {
  sshHost: string;
  sshPort?: number;
  sshUser?: string;
  /** Host on the remote side — usually 127.0.0.1 because the DB is locally bound */
  remoteHost?: string;
  remotePort: number;
  localPort: number;
}

export interface SshTunnel {
  localPort: number;
  destroy(): void;
}

/**
 * Opens a persistent SSH port-forward tunnel with automatic reconnection.
 *
 * Local connections to 127.0.0.1:localPort are forwarded through SSH to
 * remoteHost:remotePort on the SSH server — letting the bot reach a DB that
 * is only bound to 127.0.0.1 on the remote machine.
 *
 * Resolves once the tunnel is ready for the first time. If the SSH connection
 * drops later, it reconnects automatically in the background.
 */
export function openSshTunnel(opts: TunnelOptions): Promise<SshTunnel> {
  const {
    sshHost,
    sshPort = config.SSH_PORT,
    sshUser = "root",
    remoteHost = "127.0.0.1",
    remotePort,
    localPort,
  } = opts;

  return new Promise((resolve, reject) => {
    const key = (() => {
      try {
        return readFileSync(config.SSH_KEY_PATH);
      } catch {
        return null;
      }
    })();

    if (!key) {
      reject(new Error(`SSH tunnel: key not found at ${config.SSH_KEY_PATH}`));
      return;
    }

    let destroyed = false;
    let resolved = false;
    // Always points to the current live SSH client so the TCP server handler
    // picks up the new connection automatically after a reconnect.
    let activeConn: InstanceType<typeof Client> | null = null;
    let tcpServer: net.Server | null = null;

    function scheduleReconnect(delayMs = 5000) {
      if (destroyed) return;
      logger.warn({ sshHost, delayMs }, "SSH tunnel will reconnect");
      setTimeout(connect, delayMs);
    }

    function connect() {
      if (destroyed) return;

      const conn = new Client();

      conn.on("ready", () => {
        if (destroyed) { conn.end(); return; }

        activeConn = conn;
        logger.info({ sshHost, localPort, remotePort }, "SSH tunnel SSH session ready");

        if (tcpServer) {
          // Already listening from a previous connect — nothing else to do.
          if (!resolved) { resolved = true; resolve({ localPort, destroy }); }
          return;
        }

        // First connect — create the local TCP server.
        tcpServer = net.createServer((sock) => {
          const conn = activeConn;
          if (!conn) {
            logger.warn("SSH tunnel: no active SSH connection, dropping socket");
            sock.destroy();
            return;
          }

          conn.forwardOut(
            "127.0.0.1",
            sock.remotePort ?? 0,
            remoteHost,
            remotePort,
            (err, stream) => {
              if (err) {
                logger.debug({ err: err.message }, "SSH tunnel forwardOut failed");
                sock.destroy();
                return;
              }
              sock.pipe(stream);
              stream.pipe(sock);
              stream.on("close", () => sock.destroy());
              sock.on("close", () => stream.destroy());
              sock.on("error", () => stream.destroy());
              stream.on("error", () => sock.destroy());
            },
          );
        });

        tcpServer.listen(localPort, "127.0.0.1", () => {
          logger.info(
            { sshHost, localPort, remoteHost, remotePort },
            `SSH tunnel ready: 127.0.0.1:${localPort} → [${sshHost}] ${remoteHost}:${remotePort}`,
          );
          if (!resolved) {
            resolved = true;
            resolve({ localPort, destroy });
          }
        });

        tcpServer.on("error", (err) => {
          logger.error({ err: err.message, localPort }, "SSH tunnel TCP server error");
          if (!resolved) { resolved = true; reject(err); }
        });
      });

      conn.on("error", (err) => {
        logger.error({ sshHost, err: err.message }, "SSH tunnel connection error");
        activeConn = null;
        if (!resolved) { resolved = true; reject(err); return; }
        scheduleReconnect();
      });

      conn.on("close", () => {
        if (activeConn === conn) activeConn = null;
        if (!destroyed) {
          logger.warn({ sshHost }, "SSH tunnel disconnected");
          scheduleReconnect();
        }
      });

      conn.connect({
        host: sshHost,
        port: sshPort,
        username: sshUser,
        privateKey: key,
        passphrase: config.SSH_PASSPHRASE || undefined,
        readyTimeout: 15_000,
      });
    }

    function destroy() {
      destroyed = true;
      activeConn?.end();
      tcpServer?.close();
    }

    connect();
  });
}

/**
 * Rewrite the host:port in a PostgreSQL DSN to point to the tunnel's local port.
 * postgresql://user:pass@199.231.166.2:5433/db
 *   → postgresql://user:pass@127.0.0.1:15433/db
 */
export function rewriteDsnForTunnel(dsn: string, localPort: number): string {
  return dsn.replace(/@[^/]+\//, `@127.0.0.1:${localPort}/`);
}
