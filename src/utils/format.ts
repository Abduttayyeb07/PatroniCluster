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
  const { rpcHeight, rpcLatencyMs, dbs, timestamp } = snapshot;

  const rpcLine =
    rpcHeight !== null
      ? `🌐 *RPC Height:* ${esc(rpcHeight.toLocaleString())}  ⏱ ${esc(String(rpcLatencyMs))}ms`
      : "🔴 *RPC:* UNREACHABLE";

  const lines: string[] = [rpcLine, ""];

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

    lines.push(
      `>*${esc(db.label)}*  ·  ${esc(db.host)}`,
      `>Srv: ${srvEmoji} ${esc(pingStr)}  ·  DB: ${dbEmoji}`,
      `>H: ${esc(heightStr)}  ·  Gap: ${esc(gapStr)}`,
      "",
    );
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

export function formatRpcInfo(
  height: number | null,
  latencyMs: number,
  error?: string,
): string {
  if (height === null) {
    return [
      "🔴 *RPC Status*",
      "",
      ">❌ Unreachable",
      error ? `>${esc(error)}` : "",
    ].join("\n");
  }
  return [
    "🌐 *RPC Status*",
    "",
    `>📊 *Height:* ${esc(height.toLocaleString())}`,
    `>⏱ *Latency:* ${esc(String(latencyMs))}ms`,
    `>🔗 *Endpoint:* ZigChain Mainnet`,
    "",
    `🕐 _${ts()} UTC_`,
  ].join("\n");
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

export function formatDownAlert(label: string, type: string): string {
  return [
    `🔴 *DOWN: ${esc(label)}*`,
    "",
    `>📊 Type: ${esc(type)}`,
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

export function formatRpcDown(): string {
  return [
    `🔴 *RPC UNREACHABLE*`,
    "",
    `>Cannot fetch ZigChain block height`,
    `>Endpoint may be down or network issue`,
    "",
    `🕐 _${ts()} UTC_`,
  ].join("\n");
}

// ═══════════════════════════════════════════════
// Server sub-menu formatters (SSH-based)
// ═══════════════════════════════════════════════

import type { ServerStats } from "../utils/ssh.js";

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
