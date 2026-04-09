import { Client } from "ssh2";
import { readFileSync } from "node:fs";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

/** Cached private key content */
let privateKey: Buffer | undefined;
let keyLoadAttempted = false;

function getPrivateKey(): Buffer | undefined {
  if (keyLoadAttempted) return privateKey;
  keyLoadAttempted = true;
  if (!config.SSH_KEY_PATH) return undefined;
  try {
    privateKey = readFileSync(config.SSH_KEY_PATH);
    logger.info({ path: config.SSH_KEY_PATH }, "SSH private key loaded");
    return privateKey;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, path: config.SSH_KEY_PATH }, "SSH key not found — server stats unavailable");
    return undefined;
  }
}

/**
 * Get SSH username for a specific host from env vars.
 * Looks for SSH_USER_<IP_WITH_UNDERSCORES>, e.g. SSH_USER_162_55_80_238
 * Falls back to "root".
 */
function getUserForHost(host: string): string {
  const envKey = `SSH_USER_${host.replace(/\./g, "_")}`;
  return process.env[envKey] || "root";
}

export interface ServerStats {
  host: string;
  // df -h
  diskTotal: string;
  diskUsed: string;
  diskFree: string;
  diskUsePct: string;
  // free -h
  memTotal: string;
  memUsed: string;
  memFree: string;
  memAvailable: string;
  swapTotal: string;
  swapUsed: string;
  // load
  loadAvg: string;
  cpuCores: string;
  uptime: string;
}

/**
 * Execute a command on a remote server via SSH using key auth.
 */
function sshExec(host: string, command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const key = getPrivateKey();
    if (!key) {
      resolve(null);
      return;
    }

    const username = getUserForHost(host);
    const conn = new Client();
    let output = "";
    const timeout = setTimeout(() => {
      conn.end();
      resolve(null);
    }, 10000);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          conn.end();
          logger.error({ host, err: err.message }, "SSH exec error");
          resolve(null);
          return;
        }
        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          logger.debug({ host, stderr: data.toString() }, "SSH stderr");
        });
        stream.on("close", () => {
          clearTimeout(timeout);
          conn.end();
          resolve(output.trim());
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timeout);
      logger.error({ host, username, err: err.message }, "SSH connection error");
      resolve(null);
    });

    conn.connect({
      host,
      port: config.SSH_PORT,
      username,
      privateKey: key,
      passphrase: config.SSH_PASSPHRASE || undefined,
      readyTimeout: 8000,
    });
  });
}

/**
 * Parse `df -h /` output.
 */
function parseDf(raw: string): {
  total: string;
  used: string;
  free: string;
  usePct: string;
} {
  const lines = raw.split("\n").filter((l) => l.trim() && !l.startsWith("Filesystem"));
  const joined = lines.join(" ");
  const parts = joined.trim().split(/\s+/);
  const pctIdx = parts.findIndex((p) => p.includes("%"));
  if (pctIdx >= 3) {
    return {
      total: parts[pctIdx - 3] ?? "N/A",
      used: parts[pctIdx - 2] ?? "N/A",
      free: parts[pctIdx - 1] ?? "N/A",
      usePct: parts[pctIdx] ?? "N/A",
    };
  }
  return { total: "N/A", used: "N/A", free: "N/A", usePct: "N/A" };
}

/**
 * Parse `free -h` output.
 */
function parseFree(raw: string): {
  memTotal: string;
  memUsed: string;
  memFree: string;
  memAvailable: string;
  swapTotal: string;
  swapUsed: string;
} {
  const defaults = {
    memTotal: "N/A",
    memUsed: "N/A",
    memFree: "N/A",
    memAvailable: "N/A",
    swapTotal: "N/A",
    swapUsed: "N/A",
  };
  const lines = raw.split("\n");
  const memLine = lines.find((l) => l.startsWith("Mem:"));
  const swapLine = lines.find((l) => l.startsWith("Swap:"));

  if (memLine) {
    const parts = memLine.split(/\s+/);
    defaults.memTotal = parts[1] ?? "N/A";
    defaults.memUsed = parts[2] ?? "N/A";
    defaults.memFree = parts[3] ?? "N/A";
    defaults.memAvailable = parts[6] ?? parts[3] ?? "N/A";
  }
  if (swapLine) {
    const parts = swapLine.split(/\s+/);
    defaults.swapTotal = parts[1] ?? "N/A";
    defaults.swapUsed = parts[2] ?? "N/A";
  }
  return defaults;
}

/**
 * Parse uptime/load output.
 */
function parseLoad(raw: string): { loadAvg: string; uptime: string } {
  const loadMatch = raw.match(/load average:\s*(.+)/);
  const uptimeMatch = raw.match(/up\s+(.+?),\s+\d+ user/);
  return {
    loadAvg: loadMatch?.[1]?.trim() ?? "N/A",
    uptime: uptimeMatch?.[1]?.trim() ?? "N/A",
  };
}

/**
 * Collect server stats from a remote host via SSH.
 */
export async function collectServerStats(host: string): Promise<ServerStats | null> {
  const combined = await sshExec(
    host,
    "df -h / && echo '---SEPARATOR---' && free -h && echo '---SEPARATOR---' && uptime && echo '---SEPARATOR---' && nproc",
  );

  if (!combined) return null;

  const sections = combined.split("---SEPARATOR---").map((s) => s.trim());
  const disk = parseDf(sections[0] ?? "");
  const mem = parseFree(sections[1] ?? "");
  const load = parseLoad(sections[2] ?? "");
  const cpuCores = sections[3]?.trim() ?? "N/A";

  return {
    host,
    diskTotal: disk.total,
    diskUsed: disk.used,
    diskFree: disk.free,
    diskUsePct: disk.usePct,
    memTotal: mem.memTotal,
    memUsed: mem.memUsed,
    memFree: mem.memFree,
    memAvailable: mem.memAvailable,
    swapTotal: mem.swapTotal,
    swapUsed: mem.swapUsed,
    loadAvg: load.loadAvg,
    cpuCores,
    uptime: load.uptime,
  };
}

/**
 * Collect stats from all unique server hosts.
 */
export async function collectAllServerStats(
  hosts: string[],
): Promise<Map<string, ServerStats>> {
  const unique = [...new Set(hosts)];
  const results = new Map<string, ServerStats>();

  await Promise.all(
    unique.map(async (host) => {
      const stats = await collectServerStats(host);
      if (stats) {
        results.set(host, stats);
      }
    }),
  );

  return results;
}
