import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { createPgClients, closePgClients } from "./db/postgres.js";
import { createChClients, closeChClients } from "./db/clickhouse.js";
import { initChecker } from "./monitor/checker.js";
import { AlertState } from "./monitor/state.js";
import { startHeartbeat } from "./monitor/heartbeat.js";
import { startDailyReport } from "./monitor/scheduler.js";
import { createBot } from "./bot/bot.js";

async function main(): Promise<void> {
  // ── 1. Config already validated on import ──────────
  logger.info("ZigChain Indexer Monitor starting...");
  logger.info(
    {
      rpc: config.RPC_URL,
      alertGap: config.ALERT_GAP_THRESHOLD,
      recoveryGap: config.RECOVERY_GAP_THRESHOLD,
      heartbeat: config.HEARTBEAT_INTERVAL_MS,
      alertChats: config.ALERT_CHAT_IDS.length,
      allowedUsers: config.ALLOWED_USER_IDS.length,
    },
    "Configuration loaded",
  );

  // ── 2. Initialize DB clients ───────────────────────
  const pgClients = createPgClients();
  const chClients = createChClients();

  logger.info(
    {
      pgCount: pgClients.length,
      chCount: chClients.length,
      pgLabels: pgClients.map((p) => p.label),
      chLabels: chClients.map((c) => c.label),
    },
    "Database clients initialized",
  );

  // ── 3. Initialize checker with DB references ──────
  initChecker(pgClients, chClients);

  // ── 4. Create alert state tracker ─────────────────
  const alertState = new AlertState();

  // ── 5. Create and configure Grammy bot ─────────────
  const bot = createBot();

  // ── 6. Start heartbeat loop ────────────────────────
  startHeartbeat(bot, alertState);

  // ── 6b. Start daily report scheduler ───────────────
  startDailyReport(bot);

  // ── 7. Graceful shutdown ───────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutdown signal received");

    try {
      bot.stop();
      logger.info("Bot stopped");
    } catch (err: unknown) {
      logger.error({ err }, "Error stopping bot");
    }

    await closePgClients(pgClients);
    await closeChClients(chClients);

    logger.info("All connections closed. Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // ── 8. Start bot (long polling) ────────────────────
  logger.info("Starting Grammy bot (long polling)...");
  await bot.start({
    onStart: (botInfo) => {
      logger.info(
        { username: botInfo.username, id: botInfo.id },
        "✅ Bot is live!",
      );
    },
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
