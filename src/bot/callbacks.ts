import type { Bot, Context } from "grammy";
import {
  collectAllStatus,
  collectAllSizes,
  collectLatency,
  collectServerInfo,
} from "../monitor/checker.js";
import { fetchRpcHeight } from "../rpc.js";
import {
  formatGlobalStatus,
  formatSizes,
  formatRpcInfo,
  formatLatency,
  formatPing,
  formatHealth,
  formatServers,
  formatReport,
  formatAlertConfig,
  formatServerTotal,
  formatServerFree,
  formatServerLatency,
} from "../utils/format.js";
import { getMainKeyboard, getServerKeyboard } from "./keyboards.js";
import { logger } from "../utils/logger.js";

/**
 * Safely edit a message, swallowing "message is not modified" errors.
 */
async function safeEdit(
  ctx: Context,
  text: string,
  options?: Parameters<Context["editMessageText"]>[1],
): Promise<void> {
  try {
    await ctx.editMessageText(text, options);
  } catch (err: unknown) {
    const desc = String((err as Record<string, unknown>)?.["description"] ?? "");
    if (desc.includes("message is not modified")) {
      logger.debug("Edit skipped — unchanged");
      return;
    }
    throw err;
  }
}

/**
 * Register all inline keyboard callback handlers.
 */
export function registerCallbacks(bot: Bot): void {
  // ── Status ────────────────────────────────────
  bot.callbackQuery("status", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "⏳ Fetching status\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const snapshot = await collectAllStatus();
      await safeEdit(ctx, formatGlobalStatus(snapshot), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: status");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });

  // ── Ping ──────────────────────────────────────
  bot.callbackQuery("ping", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "🏓 Pinging servers\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const snapshot = await collectAllStatus();
      await safeEdit(ctx, formatPing(snapshot), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: ping");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });

  // ── Latency ───────────────────────────────────
  bot.callbackQuery("latency", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "⏱ Measuring latency\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const results = await collectLatency();
      await safeEdit(ctx, formatLatency(results), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: latency");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });

  // ── Sizes ─────────────────────────────────────
  bot.callbackQuery("sizes", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "💾 Fetching sizes\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const sizes = await collectAllSizes();
      await safeEdit(ctx, formatSizes(sizes), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: sizes");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });

  // ── Servers (shows sub-menu) ──────────────────
  bot.callbackQuery("servers", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "🖥 Fetching server details\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const snapshot = await collectAllStatus();
      await safeEdit(ctx, formatServers(snapshot), {
        parse_mode: "MarkdownV2",
        reply_markup: getServerKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: servers");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getServerKeyboard() });
    }
  });

  // ── Server Total Storage ──────────────────────
  bot.callbackQuery("srv_total", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "💿 Fetching total storage\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const info = await collectServerInfo();
      await safeEdit(ctx, formatServerTotal(info), {
        parse_mode: "MarkdownV2",
        reply_markup: getServerKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: srv_total");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getServerKeyboard() });
    }
  });

  // ── Server Free Storage ───────────────────────
  bot.callbackQuery("srv_free", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "📂 Fetching free storage\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const info = await collectServerInfo();
      await safeEdit(ctx, formatServerFree(info), {
        parse_mode: "MarkdownV2",
        reply_markup: getServerKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: srv_free");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getServerKeyboard() });
    }
  });

  // ── Server Latency ────────────────────────────
  bot.callbackQuery("srv_latency", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "⏱ Measuring server latency\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const info = await collectServerInfo();
      await safeEdit(ctx, formatServerLatency(info), {
        parse_mode: "MarkdownV2",
        reply_markup: getServerKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: srv_latency");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getServerKeyboard() });
    }
  });

  // ── Home (back to main menu) ──────────────────
  bot.callbackQuery("home", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const snapshot = await collectAllStatus();
      await safeEdit(ctx, formatGlobalStatus(snapshot), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: home");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });

  // ── Health ────────────────────────────────────
  bot.callbackQuery("health", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "🩺 Checking health\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const snapshot = await collectAllStatus();
      await safeEdit(ctx, formatHealth(snapshot), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: health");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });

  // ── RPC ───────────────────────────────────────
  bot.callbackQuery("rpc", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "🌐 Fetching RPC\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const result = await fetchRpcHeight();
      await safeEdit(ctx, formatRpcInfo(result.height, result.latencyMs, result.error), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: rpc");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });

  // ── Report ────────────────────────────────────
  bot.callbackQuery("report", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await safeEdit(ctx, "📋 Generating report\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const [snapshot, sizes] = await Promise.all([
        collectAllStatus(),
        collectAllSizes(),
      ]);
      await safeEdit(ctx, formatReport(snapshot, sizes), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: report");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });

  // ── Refresh ───────────────────────────────────
  bot.callbackQuery("refresh", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Refreshing..." });
    try {
      await safeEdit(ctx, "♻️ Refreshing\\.\\.\\.", { parse_mode: "MarkdownV2" });
      const snapshot = await collectAllStatus();
      await safeEdit(ctx, formatGlobalStatus(snapshot), {
        parse_mode: "MarkdownV2",
        reply_markup: getMainKeyboard(),
      });
    } catch (err: unknown) {
      logger.error({ err }, "Callback: refresh");
      await safeEdit(ctx, "❌ Failed\\.", { parse_mode: "MarkdownV2", reply_markup: getMainKeyboard() });
    }
  });
}
