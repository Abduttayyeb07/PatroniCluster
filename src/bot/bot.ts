import { Bot } from "grammy";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { registerHandlers } from "./handlers.js";
import { registerCallbacks } from "./callbacks.js";

/**
 * Create and configure the Grammy bot instance.
 * Sets up auth middleware, command handlers, and callback handlers.
 */
export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // ── Auth Middleware ─────────────────────────────────
  // Check every incoming update against the allowed user ID list.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;

    if (userId === undefined || !config.ALLOWED_USER_IDS.includes(userId)) {
      logger.warn(
        { userId, username: ctx.from?.username },
        "Unauthorized access attempt",
      );
      await ctx.reply("⛔ Unauthorized");
      return;
    }

    await next();
  });

  // ── Register Handlers ──────────────────────────────
  registerHandlers(bot);
  registerCallbacks(bot);

  // ── Error Handler ──────────────────────────────────
  bot.catch((err) => {
    logger.error(
      { err: err.error, ctx: err.ctx?.update?.update_id },
      "Unhandled bot error",
    );
  });

  return bot;
}
