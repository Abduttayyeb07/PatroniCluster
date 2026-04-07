import type { DbStatus, SyncSnapshot } from "../monitor/checker.js";

/**
 * Escape special characters for Telegram MarkdownV2.
 * Must escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
function esc(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Gap status emoji based on block gap.
 */
function gapEmoji(gap: number | null): string {
  if (gap === null) return "⚫";
  if (gap < 100) return "🟢";
  if (gap <= 500) return "🟡";
  return "🔴";
}

/**
 * Pad a string to a fixed width (right-pad).
 */
function pad(str: string, len: number): string {
  return str.padEnd(len);
}

/**
 * Format the global sync status as a MarkdownV2 monospace table.
 */
export function formatGlobalStatus(snapshot: SyncSnapshot): string {
  const { rpcHeight, rpcLatencyMs, dbs, timestamp } = snapshot;

  const rpcLine =
    rpcHeight !== null
      ? `🌐 *RPC Height:* ${esc(rpcHeight.toLocaleString())}  ⏱ ${esc(String(rpcLatencyMs))}ms`
      : "🔴 *RPC:* UNREACHABLE";

  const header = `${rpcLine}\n\n`;

  // Build monospace table
  const colDb = 6;
  const colType = 12;
  const colHeight = 12;
  const colGap = 10;
  const colStatus = 3;

  const divider = `${"─".repeat(colDb + colType + colHeight + colGap + colStatus + 8)}`;

  let table = "```\n";
  table += `${pad("DB", colDb)} ${pad("Type", colType)} ${pad("Height", colHeight)} ${pad("Gap", colGap)} St\n`;
  table += `${divider}\n`;

  for (const db of dbs) {
    const heightStr =
      db.height !== null ? db.height.toLocaleString() : "DOWN";
    const gapStr =
      db.gap !== null ? db.gap.toLocaleString() : "N/A";

    table += `${pad(db.label, colDb)} ${pad(db.type, colType)} ${pad(heightStr, colHeight)} ${pad(gapStr, colGap)} ${db.isDown ? "🔴" : gapEmoji(db.gap)}\n`;
  }

  table += "```\n";

  const ts = esc(timestamp.toISOString().replace("T", " ").slice(0, 19));
  const footer = `\n🕐 _${ts} UTC_`;

  return header + table + footer;
}

/**
 * Format a lag alert message.
 */
export function formatAlert(db: DbStatus, rpcHeight: number): string {
  const lines = [
    `⚠️ *ALERT: ${esc(db.label)} LAGGING*`,
    ``,
    `📊 *Type:* ${esc(db.type)}`,
    `🌐 *RPC Height:* ${esc(rpcHeight.toLocaleString())}`,
    `💾 *DB Height:* ${esc((db.height ?? 0).toLocaleString())}`,
    `📏 *Gap:* ${esc((db.gap ?? 0).toLocaleString())} blocks`,
    ``,
    `🕐 _${esc(new Date().toISOString().replace("T", " ").slice(0, 19))} UTC_`,
  ];
  return lines.join("\n");
}

/**
 * Format a DB down alert message.
 */
export function formatDownAlert(label: string, type: string): string {
  const lines = [
    `🔴 *DOWN: ${esc(label)}*`,
    ``,
    `📊 *Type:* ${esc(type)}`,
    `❌ Connection failed — unable to query block height`,
    ``,
    `🕐 _${esc(new Date().toISOString().replace("T", " ").slice(0, 19))} UTC_`,
  ];
  return lines.join("\n");
}

/**
 * Format a recovery message.
 */
export function formatRecovery(db: DbStatus): string {
  const lines = [
    `✅ *RECOVERED: ${esc(db.label)}*`,
    ``,
    `📊 *Type:* ${esc(db.type)}`,
    `📏 *Gap:* ${esc((db.gap ?? 0).toLocaleString())} blocks`,
    `💾 *Height:* ${esc((db.height ?? 0).toLocaleString())}`,
    ``,
    `🕐 _${esc(new Date().toISOString().replace("T", " ").slice(0, 19))} UTC_`,
  ];
  return lines.join("\n");
}

/**
 * Format RPC unreachable alert.
 */
export function formatRpcDown(): string {
  const lines = [
    `🔴 *RPC UNREACHABLE*`,
    ``,
    `Cannot fetch ZigChain block height`,
    `Endpoint may be down or network issue detected`,
    ``,
    `🕐 _${esc(new Date().toISOString().replace("T", " ").slice(0, 19))} UTC_`,
  ];
  return lines.join("\n");
}

/**
 * Format database sizes as a monospace table.
 */
export function formatSizes(
  sizes: Record<string, string | null>,
): string {
  const colDb = 6;
  const colSize = 20;
  const divider = `${"─".repeat(colDb + colSize + 3)}`;

  let table = "💾 *Database Sizes*\n\n```\n";
  table += `${pad("DB", colDb)} ${pad("Size", colSize)}\n`;
  table += `${divider}\n`;

  for (const [label, size] of Object.entries(sizes)) {
    table += `${pad(label, colDb)} ${pad(size ?? "N/A", colSize)}\n`;
  }

  table += "```\n";
  table += `\n🕐 _${esc(new Date().toISOString().replace("T", " ").slice(0, 19))} UTC_`;

  return table;
}

/**
 * Format RPC info message.
 */
export function formatRpcInfo(
  height: number | null,
  latencyMs: number,
  error?: string,
): string {
  if (height === null) {
    return `🔴 *RPC Status*\n\n❌ Unreachable\n${error ? `Error: ${esc(error)}` : ""}`;
  }
  const lines = [
    `🌐 *RPC Status*`,
    ``,
    `📊 *Height:* ${esc(height.toLocaleString())}`,
    `⏱ *Latency:* ${esc(String(latencyMs))}ms`,
    `🔗 *Endpoint:* ZigChain Mainnet`,
    ``,
    `🕐 _${esc(new Date().toISOString().replace("T", " ").slice(0, 19))} UTC_`,
  ];
  return lines.join("\n");
}
