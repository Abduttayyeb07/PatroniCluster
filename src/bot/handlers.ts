import type { Bot } from "grammy";
import { getMainKeyboard } from "./keyboards.js";
import { formatHelp } from "../utils/format.js";
import { logger } from "../utils/logger.js";

/** Bot start time for /uptime */
const startTime = new Date();

/**
 * All bot commands — registered with Telegram for autocomplete.
 */
const COMMANDS = [
  { command: "start", description: "🏠 Launch control panel" },
  { command: "uptime", description: "⏳ Bot uptime" },
  { command: "help", description: "📋 All commands" },
];

/**
 * Register slash command handlers.
 */
export function registerHandlers(bot: Bot): void {
  // Register commands with Telegram for autocomplete
  bot.api.setMyCommands(COMMANDS).catch((err) => {
    logger.warn({ err }, "Failed to set bot commands");
  });

  // ── /start ────────────────────────────────────
  bot.command("start", async (ctx) => {
    const text = [
      "🤖 *ZigChain Indexer Monitor*",
      "",
      "I monitor 5 indexer databases against",
      "the live ZigChain RPC endpoint\\.",
      "",
      ">📊 3 PostgreSQL \\+ 2 ClickHouse",
      ">🔔 Automatic lag/down alerts",
      ">✅ Recovery notifications",
      "",
      "Use the buttons below to navigate:",
    ].join("\n");

    await ctx.reply(text, {
      parse_mode: "MarkdownV2",
      reply_markup: getMainKeyboard(),
    });

    logger.info(
      { userId: ctx.from?.id, username: ctx.from?.username },
      "/start command received",
    );
  });

  // ── /help ─────────────────────────────────────
  bot.command("help", async (ctx) => {
    await ctx.reply(formatHelp(), {
      parse_mode: "MarkdownV2",
      reply_markup: getMainKeyboard(),
    });
  });

  // ── /uptime ───────────────────────────────────
  bot.command("uptime", async (ctx) => {
    const now = new Date();
    const diffMs = now.getTime() - startTime.getTime();
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    const esc = (s: string) => s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");

    const text = [
      "⏳ *Bot Uptime*",
      "",
      `>⏱ *Uptime:* ${esc(parts.join(" "))}`,
      `>🚀 *Started:* ${esc(startTime.toISOString().replace("T", " ").slice(0, 19))} UTC`,
      `>🕐 *Now:* ${esc(now.toISOString().replace("T", " ").slice(0, 19))} UTC`,
    ].join("\n");

    await ctx.reply(text, { parse_mode: "MarkdownV2" });
  });
}
