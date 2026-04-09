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
  diskFreePct: number; // numeric free % for alerts
  // free -h
  memTotal: string;
  memUsed: string;
  memFree: string;
  memAvailable: string;
  memUsedPct: number; // numeric used %
  swapTotal: string;
  swapUsed: string;
  swapUsedPct: number;
  // cpu & load
  loadAvg: string;
  cpuCores: string;
  cpuUsagePct: string;
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
    }, 15000);

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
        stream.stderr.on("data", (_data: Buffer) => {
          // silently ignore stderr
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
      readyTimeout: 10000,
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
  freePct: number;
} {
  const lines = raw.split("\n").filter((l) => l.trim() && !l.startsWith("Filesystem"));
  const joined = lines.join(" ");
  const parts = joined.trim().split(/\s+/);
  const pctIdx = parts.findIndex((p) => p.includes("%"));
  if (pctIdx >= 3) {
    const usePctStr = parts[pctIdx] ?? "0%";
    const usePctNum = parseInt(usePctStr.replace("%", ""), 10) || 0;
    return {
      total: parts[pctIdx - 3] ?? "N/A",
      used: parts[pctIdx - 2] ?? "N/A",
      free: parts[pctIdx - 1] ?? "N/A",
      usePct: usePctStr,
      freePct: 100 - usePctNum,
    };
  }
  return { total: "N/A", used: "N/A", free: "N/A", usePct: "N/A", freePct: 100 };
}

/**
 * Parse `free -h` and `free` (bytes) output.
 */
function parseFree(rawH: string, rawBytes: string): {
  memTotal: string;
  memUsed: string;
  memFree: string;
  memAvailable: string;
  memUsedPct: number;
  swapTotal: string;
  swapUsed: string;
  swapUsedPct: number;
} {
  const result = {
    memTotal: "N/A",
    memUsed: "N/A",
    memFree: "N/A",
    memAvailable: "N/A",
    memUsedPct: 0,
    swapTotal: "N/A",
    swapUsed: "N/A",
    swapUsedPct: 0,
  };

  // Human-readable values
  const linesH = rawH.split("\n");
  const memLineH = linesH.find((l) => l.startsWith("Mem:"));
  const swapLineH = linesH.find((l) => l.startsWith("Swap:"));

  if (memLineH) {
    const parts = memLineH.split(/\s+/);
    result.memTotal = parts[1] ?? "N/A";
    result.memUsed = parts[2] ?? "N/A";
    result.memFree = parts[3] ?? "N/A";
    result.memAvailable = parts[6] ?? parts[3] ?? "N/A";
  }
  if (swapLineH) {
    const parts = swapLineH.split(/\s+/);
    result.swapTotal = parts[1] ?? "N/A";
    result.swapUsed = parts[2] ?? "N/A";
  }

  // Raw bytes for percentage calc
  const linesB = rawBytes.split("\n");
  const memLineB = linesB.find((l) => l.startsWith("Mem:"));
  const swapLineB = linesB.find((l) => l.startsWith("Swap:"));

  if (memLineB) {
    const parts = memLineB.split(/\s+/);
    const total = parseInt(parts[1] ?? "0", 10);
    const used = parseInt(parts[2] ?? "0", 10);
    result.memUsedPct = total > 0 ? Math.round((used / total) * 100) : 0;
  }
  if (swapLineB) {
    const parts = swapLineB.split(/\s+/);
    const total = parseInt(parts[1] ?? "0", 10);
    const used = parseInt(parts[2] ?? "0", 10);
    result.swapUsedPct = total > 0 ? Math.round((used / total) * 100) : 0;
  }

  return result;
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
 * Parse CPU usage from top -bn1 output.
 */
function parseCpu(raw: string): string {
  // top output: %Cpu(s):  2.3 us,  1.0 sy, ... or
  // Cpu(s):  2.3%us,  1.0%sy, ...
  const match = raw.match(/%?Cpu\(s\):\s*([\d.]+)\s*%?\s*us,?\s*([\d.]+)\s*%?\s*sy/i);
  if (match) {
    const user = parseFloat(match[1] ?? "0");
    const sys = parseFloat(match[2] ?? "0");
    return `${Math.round(user + sys)}%`;
  }
  // Fallback: try idle parsing
  const idleMatch = raw.match(/([\d.]+)\s*%?\s*id/i);
  if (idleMatch) {
    const idle = parseFloat(idleMatch[1] ?? "100");
    return `${Math.round(100 - idle)}%`;
  }
  return "N/A";
}

/**
 * Collect server stats from a remote host via SSH.
 */
export async function collectServerStats(host: string): Promise<ServerStats | null> {
  const cmd = [
    "df -h /",
    "echo '---SEP---'",
    "free -h",
    "echo '---SEP---'",
    "free -b",
    "echo '---SEP---'",
    "uptime",
    "echo '---SEP---'",
    "nproc",
    "echo '---SEP---'",
    "top -bn1 | head -5",
  ].join(" && ");

  const combined = await sshExec(host, cmd);
  if (!combined) return null;

  const sections = combined.split("---SEP---").map((s) => s.trim());
  const disk = parseDf(sections[0] ?? "");
  const mem = parseFree(sections[1] ?? "", sections[2] ?? "");
  const load = parseLoad(sections[3] ?? "");
  const cpuCores = sections[4]?.trim() ?? "N/A";
  const cpuUsagePct = parseCpu(sections[5] ?? "");

  return {
    host,
    diskTotal: disk.total,
    diskUsed: disk.used,
    diskFree: disk.free,
    diskUsePct: disk.usePct,
    diskFreePct: disk.freePct,
    memTotal: mem.memTotal,
    memUsed: mem.memUsed,
    memFree: mem.memFree,
    memAvailable: mem.memAvailable,
    memUsedPct: mem.memUsedPct,
    swapTotal: mem.swapTotal,
    swapUsed: mem.swapUsed,
    swapUsedPct: mem.swapUsedPct,
    loadAvg: load.loadAvg,
    cpuCores,
    cpuUsagePct,
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
