import type { DbStatus, SyncSnapshot } from "../monitor/checker.js";
import { config } from "../config.js";

/**
 * Escape special characters for Telegram MarkdownV2.
 */
function esc(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Gap status emoji.
 */
function gapEmoji(gap: number | null): string {
  if (gap === null) return "⚫";
  if (gap < 100) return "🟢";
  if (gap <= 500) return "🟡";
  return "🔴";
}

/**
 * Timestamp string.
 */
function ts(): string {
  return esc(new Date().toISOString().replace("T", " ").slice(0, 19));
}

// ═══════════════════════════════════════════════
// /help — Command list
// ═══════════════════════════════════════════════

export function formatHelp(): string {
  return [
    "📋 *Available Commands*",
    "",
    ">/status  — Global sync status",
    ">/ping  — Ping all servers",
    ">/latency  — Latency report",
    ">/sizes  — Database sizes",
    ">/rpc  — RPC endpoint info",
    ">/health  — Health check summary",
    ">/servers  — Server \\& DB details",
    ">/report  — Full comprehensive report",
    ">/alerts  — Alert thresholds",
    ">/uptime  — Bot uptime",
    ">/help  — Show this list",
  ].join("\n");
}

// ═══════════════════════════════════════════════
// /status — Global sync status (blockquote cards)
// ═══════════════════════════════════════════════

export function formatGlobalStatus(snapshot: SyncSnapshot): string {
  const { rpcs, dbs, timestamp } = snapshot;

  const lines: string[] = [];

  for (const rpc of rpcs) {
    const emoji = rpc.height !== null ? "🟢" : "🔴";
    const h = rpc.height !== null ? esc(rpc.height.toLocaleString()) : "DOWN";
    const lat = rpc.height !== null ? esc(`${rpc.latencyMs}ms`) : "—";
    lines.push(`>${emoji} *${esc(rpc.label)}:* ${h}  ⏱ ${lat}`);
  }

  lines.push("");

  const mainDbs = dbs.filter((db) => !db.label.toLowerCase().includes("uat"));
  const uatDbs  = dbs.filter((db) =>  db.label.toLowerCase().includes("uat"));

  function renderDb(db: DbStatus): void {
    const srvEmoji = db.pingOk ? "🟢" : "🔴";
    const dbEmoji  = db.isDown ? "🔴" : gapEmoji(db.gap);
    const pingStr  = db.pingOk ? `${db.pingMs}ms` : "FAIL";
    const heightStr = db.height !== null ? db.height.toLocaleString() : "DOWN";
    const gapStr    = db.gap    !== null ? db.gap.toLocaleString()    : "N/A";
    lines.push(
      `>*${esc(db.label)}*  ·  ${esc(db.host)}`,
      `>Srv: ${srvEmoji} ${esc(pingStr)}  ·  DB: ${dbEmoji}`,
      `>H: ${esc(heightStr)}  ·  Gap: ${esc(gapStr)}`,
      "",
    );
  }

  lines.push(`*── MAIN CLUSTER ──*`, "");
  for (const db of mainDbs) renderDb(db);

  if (uatDbs.length > 0) {
    lines.push(
      `\`${"─".repeat(32)}\``,
      `*UAT*`,
      `\`${"─".repeat(32)}\``,
      "",
    );
    for (const db of uatDbs) renderDb(db);
  }

  const t = esc(timestamp.toISOString().replace("T", " ").slice(0, 19));
  lines.push(`🕐 _${t} UTC_`);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// /ping — Server ping results
// ═══════════════════════════════════════════════

export function formatPing(snapshot: SyncSnapshot): string {
  const lines: string[] = ["🏓 *Server Ping*", ""];

  for (const db of snapshot.dbs) {
    const emoji = db.pingOk ? "🟢" : "🔴";
    const pingStr = db.pingOk ? `${db.pingMs}ms` : "Unreachable";

    lines.push(
      `>${emoji} *${esc(db.label)}*  ·  ${esc(db.host)}`,
      `>     ${esc(pingStr)}`,
      "",
    );
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// /latency — Detailed latency report
// ═══════════════════════════════════════════════

export function formatLatency(
  results: Array<{
    label: string;
    host: string;
    port: number;
    pingOk: boolean;
    pingMs: number;
    queryMs: number;
  }>,
): string {
  const lines: string[] = ["⏱ *Latency Report*", ""];

  for (const r of results) {
    const emoji = r.pingOk ? "🟢" : "🔴";
    const pingStr = r.pingOk ? `${r.pingMs}ms` : "FAIL";
    const queryStr = r.queryMs >= 0 ? `${r.queryMs}ms` : "N/A";

    lines.push(
      `>${emoji} *${esc(r.label)}*  ·  ${esc(r.host)}`,
      `>     Ping: ${esc(pingStr)}  ·  Query: ${esc(queryStr)}`,
      "",
    );
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// /sizes — Database sizes
// ═══════════════════════════════════════════════

export function formatSizes(
  sizes: Record<string, string | null>,
): string {
  const lines: string[] = ["💾 *Database Sizes*", ""];

  for (const [label, size] of Object.entries(sizes)) {
    lines.push(`>📦 *${esc(label)}* — ${esc(size ?? "N/A")}`);
  }

  lines.push("", `🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// /rpc — RPC endpoint info
// ═══════════════════════════════════════════════

import type { RpcEndpointResult } from "../rpc.js";

export function formatRpcInfo(rpcs: RpcEndpointResult[]): string {
  const lines: string[] = ["🌐 *RPC Endpoints*", ""];

  for (const rpc of rpcs) {
    const emoji = rpc.height !== null ? "🟢" : "🔴";
    lines.push(`>${emoji} *${esc(rpc.label)}*`);
    if (rpc.height !== null) {
      lines.push(
        `>  📊 Height: ${esc(rpc.height.toLocaleString())}`,
        `>  ⏱ Latency: ${esc(String(rpc.latencyMs))}ms`,
      );
    } else {
      lines.push(`>  ❌ ${esc(rpc.error ?? "Unreachable")}`);
    }
    lines.push("");
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// /health — Health check summary
// ═══════════════════════════════════════════════

export function formatHealth(snapshot: SyncSnapshot): string {
  const { rpcHeight, dbs } = snapshot;
  const totalDbs = dbs.length;
  const upDbs = dbs.filter((d) => !d.isDown).length;
  const downDbs = dbs.filter((d) => d.isDown);
  const lagging = dbs.filter(
    (d) => !d.isDown && d.gap !== null && d.gap > config.ALERT_GAP_THRESHOLD,
  );
  const serversUp = dbs.filter((d) => d.pingOk).length;

  const overallEmoji =
    downDbs.length > 0 ? "🔴" : lagging.length > 0 ? "🟡" : "🟢";
  const overallText =
    downDbs.length === 0 && lagging.length === 0
      ? "All systems healthy"
      : "Issues detected";

  const lines: string[] = [
    "🩺 *Health Check*",
    "",
    `>${overallEmoji} *Overall:* ${esc(overallText)}`,
    `>🌐 RPC: ${rpcHeight !== null ? "✅ Online" : "❌ Offline"}`,
    `>🖥 Servers: ${esc(String(serversUp))}/${esc(String(totalDbs))} reachable`,
    `>💾 Databases: ${esc(String(upDbs))}/${esc(String(totalDbs))} responding`,
    "",
  ];

  if (downDbs.length > 0) {
    lines.push("*⛔ Down:*");
    for (const db of downDbs) {
      lines.push(`>🔴 ${esc(db.label)} — ${esc(db.host)}`);
    }
    lines.push("");
  }

  if (lagging.length > 0) {
    lines.push("*⚠️ Lagging:*");
    for (const db of lagging) {
      lines.push(
        `>🟡 ${esc(db.label)} — Gap: ${esc((db.gap ?? 0).toLocaleString())}`,
      );
    }
    lines.push("");
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// /servers — Detailed server info
// ═══════════════════════════════════════════════

export function formatServers(snapshot: SyncSnapshot): string {
  const lines: string[] = ["🖥 *Server Details*", ""];

  // Group by unique host
  const hostMap = new Map<
    string,
    { dbs: DbStatus[]; pingOk: boolean; pingMs: number }
  >();

  for (const db of snapshot.dbs) {
    const existing = hostMap.get(db.host);
    if (existing) {
      existing.dbs.push(db);
    } else {
      hostMap.set(db.host, {
        dbs: [db],
        pingOk: db.pingOk,
        pingMs: db.pingMs,
      });
    }
  }

  for (const [host, info] of hostMap) {
    const srvEmoji = info.pingOk ? "🟢" : "🔴";
    const pingStr = info.pingOk ? `${info.pingMs}ms` : "Unreachable";

    lines.push(`>${srvEmoji} *${esc(host)}*  ·  ${esc(pingStr)}`);

    for (const db of info.dbs) {
      const dbEmoji = db.isDown ? "🔴" : gapEmoji(db.gap);
      const dbType = db.type === "PostgreSQL" ? "PG" : "CH";
      lines.push(
        `>  ${dbEmoji} ${esc(db.label)} \\(${esc(dbType)}\\)`,
      );
    }
    lines.push("");
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// /report — Full comprehensive report
// ═══════════════════════════════════════════════

export function formatReport(
  snapshot: SyncSnapshot,
  sizes: Record<string, string | null>,
): string {
  const { rpcHeight, rpcLatencyMs, dbs, timestamp } = snapshot;
  const upCount = dbs.filter((d) => !d.isDown).length;
  const srvUp = dbs.filter((d) => d.pingOk).length;

  const lines: string[] = [
    "📋 *Full Report*",
    "",
    // RPC Section
    ">🌐 *RPC*",
    rpcHeight !== null
      ? `>Height: ${esc(rpcHeight.toLocaleString())}  ·  Latency: ${esc(String(rpcLatencyMs))}ms`
      : ">❌ Unreachable",
    `>Servers: ${esc(String(srvUp))}/${esc(String(dbs.length))} up  ·  DBs: ${esc(String(upCount))}/${esc(String(dbs.length))} up`,
    "",
  ];

  // Per-DB section
  for (const db of dbs) {
    const srvEmoji = db.pingOk ? "🟢" : "🔴";
    const dbEmoji = db.isDown ? "🔴" : gapEmoji(db.gap);
    const pingStr = db.pingOk ? `${db.pingMs}ms` : "FAIL";
    const heightStr = db.height !== null
      ? db.height.toLocaleString()
      : "DOWN";
    const gapStr = db.gap !== null
      ? db.gap.toLocaleString()
      : "N/A";
    const sizeStr = sizes[db.label] ?? "N/A";

    lines.push(
      `>*${esc(db.label)}*  ·  ${esc(db.host)}`,
      `>Srv: ${srvEmoji} ${esc(pingStr)}  ·  DB: ${dbEmoji}  ·  Size: ${esc(sizeStr)}`,
      `>H: ${esc(heightStr)}  ·  Gap: ${esc(gapStr)}`,
      "",
    );
  }

  const t = esc(timestamp.toISOString().replace("T", " ").slice(0, 19));
  lines.push(`🕐 _${t} UTC_`);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// /alerts — Alert configuration
// ═══════════════════════════════════════════════

export function formatAlertConfig(): string {
  return [
    "🔔 *Alert Configuration*",
    "",
    `>⚠️ *Lag threshold:* ${esc(String(config.ALERT_GAP_THRESHOLD))} blocks`,
    `>✅ *Recovery threshold:* ${esc(String(config.RECOVERY_GAP_THRESHOLD))} blocks`,
    `>⏱ *Check interval:* ${esc(String(config.HEARTBEAT_INTERVAL_MS / 1000))}s`,
    `>📡 *Alert channels:* ${esc(String(config.ALERT_CHAT_IDS.length))}`,
    `>👤 *Allowed users:* ${esc(String(config.ALLOWED_USER_IDS.length))}`,
  ].join("\n");
}

// ═══════════════════════════════════════════════
// Alert messages (used by heartbeat)
// ═══════════════════════════════════════════════

export function formatAlert(db: DbStatus, rpcHeight: number): string {
  return [
    `⚠️ *ALERT: ${esc(db.label)} LAGGING*`,
    "",
    `>🖥 Server: ${esc(db.host)}`,
    `>🌐 RPC Height: ${esc(rpcHeight.toLocaleString())}`,
    `>💾 DB Height: ${esc((db.height ?? 0).toLocaleString())}`,
    `>📏 Gap: ${esc((db.gap ?? 0).toLocaleString())} blocks`,
    "",
    `🕐 _${ts()} UTC_`,
  ].join("\n");
}

export function formatDownAlert(label: string, type: string, host: string): string {
  return [
    `🔴 *DOWN: ${esc(label)}*`,
    "",
    `>📊 Type: ${esc(type)}`,
    `>🖥 Host: ${esc(host)}`,
    `>❌ Connection failed`,
    "",
    `🕐 _${ts()} UTC_`,
  ].join("\n");
}

export function formatRecovery(db: DbStatus): string {
  return [
    `✅ *RECOVERED: ${esc(db.label)}*`,
    "",
    `>🖥 Server: ${esc(db.host)}`,
    `>📏 Gap: ${esc((db.gap ?? 0).toLocaleString())} blocks`,
    `>💾 Height: ${esc((db.height ?? 0).toLocaleString())}`,
    "",
    `🕐 _${ts()} UTC_`,
  ].join("\n");
}

export function formatRpcDown(rpcs: RpcEndpointResult[]): string {
  const lines: string[] = [`🔴 *RPC UNREACHABLE*`, ""];

  for (const rpc of rpcs) {
    lines.push(`>🌐 *${esc(rpc.label)}*`);
    lines.push(`>  📡 ${esc(rpc.url)}`);
    if (rpc.error) {
      lines.push(`>  ❌ ${esc(rpc.error)}`);
    }
    lines.push("");
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// Server sub-menu formatters (SSH-based)
// ═══════════════════════════════════════════════

import type { ServerStats } from "../utils/ssh.js";
import { getCpuAverages } from "../monitor/cpuHistory.js";

const SSH_UNAVAILABLE = [
  ">⚠️ SSH not configured or unreachable",
  ">Ensure SSH key is mounted in Docker",
].join("\n");

function diskEmoji(freePct: number): string {
  if (freePct <= 10) return "🔴";
  if (freePct <= 20) return "🟠";
  if (freePct <= 40) return "🟡";
  return "🟢";
}

function memEmoji(usedPct: number): string {
  if (usedPct >= 90) return "🔴";
  if (usedPct >= 75) return "🟠";
  return "🟢";
}

function bar(pct: number, len = 10): string {
  const filled = Math.round((pct / 100) * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

function cpuAvgLine(host: string): string[] {
  const history = getCpuAverages(host);
  const lines: string[] = [];

  for (const hours of [6, 12, 24] as const) {
    const avg = history.averages[hours];
    const above = history.aboveThreshold[hours];
    const status = above === null ? "N/A" : above ? "ABOVE 50%" : "OK";
    const avgText = avg === null ? "N/A" : `${avg}%`;
    lines.push(`>  ${hours}h avg: ${esc(avgText)} \\- ${esc(status)}`);
  }

  lines.push(`>  Samples: ${esc(String(history.samples))}`);
  return lines;
}

export function formatServerTotal(stats: Map<string, ServerStats>): string {
  const lines: string[] = ["💿 *Server Storage*", ""];

  if (stats.size === 0) {
    lines.push(SSH_UNAVAILABLE, "", `🕐 _${ts()} UTC_`);
    return lines.join("\n");
  }

  for (const [host, s] of stats) {
    const usePct = parseInt(s.diskUsePct.replace("%", ""), 10) || 0;
    const emoji = diskEmoji(s.diskFreePct);
    const warn = s.diskFreePct <= 20
      ? `\n>  ⚠️ *WARNING: Only ${s.diskFreePct}% free\\!*`
      : "";

    lines.push(
      `>${emoji} *${esc(host)}*`,
      `>  💿 Total: *${esc(s.diskTotal)}*`,
      `>  💾 Used: ${esc(s.diskUsed)} \\(${esc(s.diskUsePct)}\\)`,
      `>  📂 Free: ${esc(s.diskFree)} \\(${s.diskFreePct}%\\)`,
      `>  \\[${esc(bar(usePct))}\\] ${esc(s.diskUsePct)}${warn}`,
      "",
    );
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

export function formatServerFree(stats: Map<string, ServerStats>): string {
  const lines: string[] = ["🧠 *Server Memory*", ""];

  if (stats.size === 0) {
    lines.push(SSH_UNAVAILABLE, "", `🕐 _${ts()} UTC_`);
    return lines.join("\n");
  }

  for (const [host, s] of stats) {
    const ramEmoji = memEmoji(s.memUsedPct);
    const swapWarn = s.swapUsedPct > 50
      ? "\n>  ⚠️ High swap usage\\!"
      : "";

    lines.push(
      `>${ramEmoji} *${esc(host)}*`,
      `>  🧠 RAM: ${esc(s.memUsed)} / ${esc(s.memTotal)} \\(${s.memUsedPct}% used\\)`,
      `>  \\[${esc(bar(s.memUsedPct))}\\]`,
      `>  💡 Available: ${esc(s.memAvailable)}`,
      `>  🔄 Swap: ${esc(s.swapUsed)} / ${esc(s.swapTotal)} \\(${s.swapUsedPct}%\\)${swapWarn}`,
      "",
    );
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

export function formatServerLatency(stats: Map<string, ServerStats>): string {
  const lines: string[] = ["📊 *System Load*", ""];

  if (stats.size === 0) {
    lines.push(SSH_UNAVAILABLE, "", `🕐 _${ts()} UTC_`);
    return lines.join("\n");
  }

  for (const [host, s] of stats) {
    lines.push(
      `>🖥 *${esc(host)}*`,
      `>  ⚡ Load: ${esc(s.loadAvg)}`,
      `>  🧮 CPU: ${esc(s.cpuCores)} cores`,
      `>  📊 CPU Usage: *${esc(s.cpuUsagePct)}*`,
      ...cpuAvgLine(host),
      `>  ⏳ Uptime: ${esc(s.uptime)}`,
      "",
    );
  }

  lines.push(`🕐 _${ts()} UTC_`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════
// Disk space alert formatter
// ═══════════════════════════════════════════════

export function formatDiskAlert(stats: Map<string, ServerStats>, threshold = 20): string | null {
  const warnings: string[] = [];

  for (const [host, s] of stats) {
    if (s.diskFreePct <= threshold) {
      warnings.push(
        `>🖥 *${esc(host)}*`,
        `>  📂 Free: ${esc(s.diskFree)} / ${esc(s.diskTotal)} \\(${s.diskFreePct}%\\)`,
        `>  💾 Used: ${esc(s.diskUsed)} \\(${esc(s.diskUsePct)}\\)`,
        `>  ⚠️ *Below ${threshold}% threshold\\!*`,
        "",
      );
    }
  }

  if (warnings.length === 0) return null;

  return [
    "🚨 *DISK SPACE WARNING*",
    "",
    ...warnings,
    `🕐 _${ts()} UTC_`,
  ].join("\n");
}

// ═══════════════════════════════════════════════
// Daily scheduled report
// ═══════════════════════════════════════════════

export function formatDailyReport(
  snapshot: SyncSnapshot,
  serverStats: Map<string, ServerStats>,
): string {
  const lines: string[] = [
    "📋 *Daily Status Report*",
    `🕐 _${ts()} UTC_`,
    "",
  ];

  // ── Sync overview ──
  lines.push("*── 🔗 Sync Status ──*", "");
  const rpcStr = snapshot.rpcHeight !== null
    ? String(snapshot.rpcHeight)
    : "Unreachable";
  lines.push(`>🌐 RPC Height: *${esc(rpcStr)}*`);

  const downCount = snapshot.dbs.filter((d) => d.isDown).length;
  const lagging = snapshot.dbs.filter((d) => !d.isDown && d.gap !== null && d.gap > 100);
  const healthy = snapshot.dbs.filter((d) => !d.isDown && (d.gap === null || d.gap <= 100));

  lines.push(
    `>✅ Healthy: ${healthy.length}  ⚠️ Lagging: ${lagging.length}  ❌ Down: ${downCount}`,
    "",
  );

  for (const db of snapshot.dbs) {
    const emoji = db.isDown ? "❌" : gapEmoji(db.gap);
    const status = db.isDown
      ? "DOWN"
      : db.gap !== null
        ? `${db.gap > 0 ? "+" : ""}${db.gap} blocks`
        : "N/A";
    lines.push(`>${emoji} ${esc(db.label)}: ${esc(status)}`);
  }
  lines.push("");

  // ── Server stats ──
  if (serverStats.size > 0) {
    lines.push("*── 💿 Storage ──*", "");
    for (const [host, s] of serverStats) {
      const de = diskEmoji(s.diskFreePct);
      lines.push(
        `>${de} *${esc(host)}*`,
        `>  ${esc(s.diskUsed)} / ${esc(s.diskTotal)} \\(${esc(s.diskUsePct)}\\) · Free: ${esc(s.diskFree)}`,
      );
    }
    lines.push("");

    lines.push("*── 🧠 Memory ──*", "");
    for (const [host, s] of serverStats) {
      const me = memEmoji(s.memUsedPct);
      lines.push(
        `>${me} *${esc(host)}*`,
        `>  RAM: ${esc(s.memUsed)} / ${esc(s.memTotal)} \\(${s.memUsedPct}%\\) · Swap: ${esc(s.swapUsed)}/${esc(s.swapTotal)}`,
      );
    }
    lines.push("");

    lines.push("*── 📊 Load ──*", "");
    for (const [host, s] of serverStats) {
      lines.push(
        `>🖥 *${esc(host)}*`,
        `>  CPU: ${esc(s.cpuUsagePct)} \\(${esc(s.cpuCores)} cores\\) · Load: ${esc(s.loadAvg)} · Up: ${esc(s.uptime)}`,
        ...cpuAvgLine(host),
      );
    }
    lines.push("");
  }

  // ── Warnings ──
  const diskWarnings: string[] = [];
  for (const [host, s] of serverStats) {
    if (s.diskFreePct <= 20) {
      diskWarnings.push(`>  ⚠️ ${esc(host)}: only ${s.diskFreePct}% disk free`);
    }
    if (s.memUsedPct >= 90) {
      diskWarnings.push(`>  ⚠️ ${esc(host)}: ${s.memUsedPct}% RAM used`);
    }
  }
  if (diskWarnings.length > 0) {
    lines.push("*── 🚨 Warnings ──*", "", ...diskWarnings, "");
  }

  lines.push("_Next report in 24h_");
  return lines.join("\n");
}
