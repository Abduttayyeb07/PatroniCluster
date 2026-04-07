import type { Bot, Context } from "grammy";
import {
  collectAllStatus,
  collectAllSizes,
} from "../monitor/checker.js";
import { fetchRpcHeight } from "../rpc.js";
import {
  formatGlobalStatus,
  formatSizes,
  formatRpcInfo,
} from "../utils/format.js";
import { getMainKeyboard } from "./keyboards.js";
import { logger } from "../utils/logger.js";

/**
 * Safely edit a message, swallowing the "message is not modified" error
 * that Telegram throws when the new content is identical to the current one.
 */
async function safeEdit(
  ctx: Context,
  text: string,
  options?: Parameters<Context["editMessageText"]>[1],
): Promise<void> {
  try {
    await ctx.editMessageText(text, options);
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    const desc = String(errObj?.["description"] ?? "");
    // Telegram returns this when message content hasn't changed
    if (desc.includes("message is not modified")) {
      logger.debug("Edit skipped — message content unchanged");
      return;
    }
    throw err; // re-throw anything else
  }
}

/**
 * Register inline keyboard callback query handlers on the bot.
 */
export function registerCallbacks(bot: Bot): void {
  bot.callbackQuery("status", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "⏳ Fetching global status\\.\\.\\.", {
        parse_mode: "MarkdownV2",
      });
      const snapshot = await collectAllStatus();
      const text = formatGlobalStatus(snapshot);
      await safeEdit(ctx, text, {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback error: status");
      await safeEdit(
        ctx,
        "❌ Failed to fetch status\\. Please try again\\.",
        { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() },
      );
    }
  });

  bot.callbackQuery("refresh", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Refreshing..." });
    try {
      await safeEdit(ctx, "♻️ Refreshing\\.\\.\\.", {
        parse_mode: "MarkdownV2",
      });
      const snapshot = await collectAllStatus();
      const text = formatGlobalStatus(snapshot);
      await safeEdit(ctx, text, {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback error: refresh");
      await safeEdit(
        ctx,
        "❌ Failed to refresh\\. Please try again\\.",
        { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() },
      );
    }
  });

  bot.callbackQuery("sizes", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "⏳ Fetching database sizes\\.\\.\\.", {
        parse_mode: "MarkdownV2",
      });
      const sizes = await collectAllSizes();
      const text = formatSizes(sizes);
      await safeEdit(ctx, text, {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback error: sizes");
      await safeEdit(
        ctx,
        "❌ Failed to fetch sizes\\. Please try again\\.",
        { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() },
      );
    }
  });

  bot.callbackQuery("rpc", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "⏳ Fetching RPC info\\.\\.\\.", {
        parse_mode: "MarkdownV2",
      });
      const rpcResult = await fetchRpcHeight();
      const text = formatRpcInfo(
        rpcResult.height,
        rpcResult.latencyMs,
        rpcResult.error,
      );
      await safeEdit(ctx, text, {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback error: rpc");
      await safeEdit(
        ctx,
        "❌ Failed to fetch RPC info\\. Please try again\\.",
        { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() },
      );
    }
  });
}
