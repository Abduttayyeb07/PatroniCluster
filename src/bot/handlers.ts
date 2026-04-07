import type { Bot } from "grammy";
import { collectAllStatus } from "../monitor/checker.js";
import { formatGlobalStatus } from "../utils/format.js";
import { getMainKeyboard } from "./keyboards.js";
import { logger } from "../utils/logger.js";

/**
 * Register command handlers on the bot.
 */
export function registerHandlers(bot: Bot): void {
  /**
   * /start — Welcome message with inline keyboard controls.
   */
  bot.command("start", async (ctx) => {
    const welcomeMsg = [
      "🤖 *ZigChain Indexer Monitor*",
      "",
      "I monitor 5 indexer databases against the live ZigChain RPC endpoint\\.",
      "",
      "📊 *3 PostgreSQL* \\+ *2 ClickHouse* instances",
      "🔔 Automatic alerts when any DB falls behind",
      "✅ Recovery notifications when sync is restored",
      "",
      "Use the buttons below to check status on\\-demand:",
    ].join("\n");

    await ctx.reply(welcomeMsg, {
      parse_mode: "MarkdownV2",
      reply_markup: getMainKeyboard(),
    });

    logger.info(
      { userId: ctx.from?.id, username: ctx.from?.username },
      "/start command received",
    );
  });

  /**
   * /status — Fetch and display current sync status.
   */
  bot.command("status", async (ctx) => {
    const loadingMsg = await ctx.reply("⏳ Fetching status\\.\\.\\.", {
      parse_mode: "MarkdownV2",
    });

    try {
      const snapshot = await collectAllStatus();
      const text = formatGlobalStatus(snapshot);

      await ctx.api.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        text,
        {
          parse_mode: "MarkdownV2",
          reply_markup: getMainKeyboard(),
        },
      );
    } catch (err: unknown) {
      logger.error({ err }, "Error handling /status command");
      await ctx.api.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        "❌ Failed to fetch status\\. Please try again\\.",
        { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() },
      );
    }

    logger.info(
      { userId: ctx.from?.id, username: ctx.from?.username },
      "/status command received",
    );
  });
}
