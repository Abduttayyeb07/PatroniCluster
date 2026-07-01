import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { createPgClients, closePgClients } from "./db/postgres.js";
import { createChClients, closeChClients } from "./db/clickhouse.js";
import { initChecker } from "./monitor/checker.js";
import { AlertState } from "./monitor/state.js";
import { startHeartbeat } from "./monitor/heartbeat.js";
import { startDailyReport } from "./monitor/scheduler.js";
import { startCpuHistorySampler } from "./monitor/cpuHistory.js";
import { createBot } from "./bot/bot.js";
import { openSshTunnel, rewriteDsnForTunnel } from "./utils/sshTunnel.js";

async function main(): Promise<void> {
  // ── 1. Config already validated on import ──────────
  logger.info("ZigChain Indexer Monitor starting...");
  logger.info(
    {
      rpc: config.RPC_URL,
      alertGap: config.ALERT_GAP_THRESHOLD,
      recoveryGap: config.RECOVERY_GAP_THRESHOLD,
      heartbeat: config.HEARTBEAT_INTERVAL_MS,
      cpuHistoryInterval: config.CPU_HISTORY_INTERVAL_MS,
      cpuAvgThreshold: config.CPU_AVG_THRESHOLD,
      alertChats: config.ALERT_CHAT_IDS.length,
      allowedUsers: config.ALLOWED_USER_IDS.length,
    },
    "Configuration loaded",
  );

  // ── 2. SSH tunnels for PostgreSQL instances ───────────
  const pgDsnOverrides: Partial<Record<"01" | "02" | "03" | "04" | "05", string>> = {};
  let pg01Tunnel: { destroy(): void } | null = null;
  let archiveTunnel: { destroy(): void } | null = null;

  if (config.PG01_SSH_HOST) {
    logger.info(
      { sshHost: config.PG01_SSH_HOST, remoteHost: config.PG01_REMOTE_HOST, localPort: config.PG01_LOCAL_PORT },
      "Opening SSH tunnel for Patroni Primary...",
    );
    try {
      pg01Tunnel = await openSshTunnel({
        sshHost: config.PG01_SSH_HOST,
        sshUser: config.PG01_SSH_USER,
        remoteHost: config.PG01_REMOTE_HOST,
        remotePort: config.PG01_REMOTE_PORT,
        localPort: config.PG01_LOCAL_PORT,
      });
      pgDsnOverrides["01"] = rewriteDsnForTunnel(config.PG_DSN_01, config.PG01_LOCAL_PORT);
      logger.info({ rewrittenDsn: pgDsnOverrides["01"]?.replace(/:([^@]+)@/, ":****@") }, "Patroni Primary DSN rewritten for tunnel");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "Failed to open SSH tunnel for Patroni Primary — will connect directly");
    }
  }

  if (config.ARCHIVE_SSH_HOST) {
    logger.info(
      { sshHost: config.ARCHIVE_SSH_HOST, localPort: config.ARCHIVE_LOCAL_PORT, remotePort: config.ARCHIVE_REMOTE_PORT },
      "Opening SSH tunnel for Postgres Archive...",
    );
    try {
      archiveTunnel = await openSshTunnel({
        sshHost: config.ARCHIVE_SSH_HOST,
        sshUser: config.ARCHIVE_SSH_USER,
        remotePort: config.ARCHIVE_REMOTE_PORT,
        localPort: config.ARCHIVE_LOCAL_PORT,
      });
      pgDsnOverrides["03"] = rewriteDsnForTunnel(config.PG_DSN_03, config.ARCHIVE_LOCAL_PORT);
      logger.info({ rewrittenDsn: pgDsnOverrides["03"]?.replace(/:([^@]+)@/, ":****@") }, "Postgres Archive DSN rewritten for tunnel");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "Failed to open SSH tunnel for Postgres Archive — will connect directly (expect timeout)");
    }
  }

  // ── 3. SSH tunnel for Testnet Postgres (if configured) ──
  let testnetTunnel: { destroy(): void } | null = null;

  if (config.TESTNET_SSH_HOST) {
    logger.info(
      { sshHost: config.TESTNET_SSH_HOST, localPort: config.TESTNET_LOCAL_PORT, remotePort: config.TESTNET_REMOTE_PORT },
      "Opening SSH tunnel for Testnet Postgres...",
    );
    try {
      testnetTunnel = await openSshTunnel({
        sshHost: config.TESTNET_SSH_HOST,
        sshUser: config.TESTNET_SSH_USER,
        sshPort: config.TESTNET_SSH_PORT,
        remotePort: config.TESTNET_REMOTE_PORT,
        localPort: config.TESTNET_LOCAL_PORT,
      });
      pgDsnOverrides["05"] = rewriteDsnForTunnel(config.PG_DSN_05, config.TESTNET_LOCAL_PORT);
      logger.info({ rewrittenDsn: pgDsnOverrides["05"]?.replace(/:([^@]+)@/, ":****@") }, "Testnet Postgres DSN rewritten for tunnel");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "Failed to open SSH tunnel for Testnet Postgres — will connect directly (expect timeout)");
    }
  }

  // ── 5. SSH tunnel for ClickHouse Primary (if configured) ──
  let chUrlOverride: string | undefined;
  let chTunnel: { destroy(): void } | null = null;

  if (config.CH_TUNNEL_SSH_HOST) {
    logger.info(
      { sshHost: config.CH_TUNNEL_SSH_HOST, localPort: config.CH_TUNNEL_LOCAL_PORT, remotePort: config.CH_TUNNEL_REMOTE_PORT },
      "Opening SSH tunnel for ClickHouse Primary...",
    );
    try {
      chTunnel = await openSshTunnel({
        sshHost: config.CH_TUNNEL_SSH_HOST,
        sshUser: config.CH_TUNNEL_SSH_USER,
        remotePort: config.CH_TUNNEL_REMOTE_PORT,
        localPort: config.CH_TUNNEL_LOCAL_PORT,
      });
      chUrlOverride = `http://127.0.0.1:${config.CH_TUNNEL_LOCAL_PORT}`;
      logger.info({ chUrlOverride }, "ClickHouse URL rewritten for tunnel");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "Failed to open SSH tunnel for ClickHouse — will connect directly");
    }
  }

  // ── 4. Initialize DB clients ───────────────────────
  const pgClients = createPgClients(pgDsnOverrides);
  const chClients = createChClients(chUrlOverride);

  logger.info(
    {
      pgCount: pgClients.length,
      chCount: chClients.length,
      pgLabels: pgClients.map((p) => p.label),
      chLabels: chClients.map((c) => c.label),
    },
    "Database clients initialized",
  );

  // ── 4. Initialize checker with DB references ──────
  initChecker(pgClients, chClients);

  // ── 5. Create alert state tracker ─────────────────
  const alertState = new AlertState();

  // ── 6. Create and configure Grammy bot ─────────────
  const bot = createBot();

  // ── 7. Start heartbeat loop ────────────────────────
  startHeartbeat(bot, alertState);

  // ── 7b. Start daily report scheduler ───────────────
  startDailyReport(bot);
  startCpuHistorySampler();

  // ── 8. Graceful shutdown ───────────────────────────
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
    pg01Tunnel?.destroy();
    archiveTunnel?.destroy();
    testnetTunnel?.destroy();
    chTunnel?.destroy();

    logger.info("All connections closed. Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // ── 9. Start bot (long polling) ────────────────────
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
