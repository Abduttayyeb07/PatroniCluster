import type { Bot } from "grammy";
import { config } from "../config.js";
import { collectAllStatus, collectServerInfo } from "./checker.js";
import { AlertState } from "./state.js";
import {
  formatAlert,
  formatDownAlert,
  formatRecovery,
  formatRpcDown,
  formatDiskAlert,
} from "../utils/format.js";
import { logger } from "../utils/logger.js";

/**
 * Send a MarkdownV2 message to ALL alert chat IDs.
 * Silently catches per-chat errors so one failing chat doesn't block others.
 */
async function broadcastAlert(bot: Bot, text: string): Promise<void> {
  await Promise.allSettled(
    config.ALERT_CHAT_IDS.map(async (chatId) => {
      try {
        await bot.api.sendMessage(chatId, text, {
          parse_mode: "MarkdownV2",
        });
      } catch (err: unknown) {
        logger.error(
          { chatId, err },
          "Failed to send alert to chat",
        );
      }
    }),
  );
}

/** Track which hosts already have an active disk alert (avoid spam) */
const diskAlertActive = new Set<string>();

/**
 * Start the background heartbeat loop.
 * Runs every HEARTBEAT_INTERVAL_MS, checks all DBs against RPC,
 * and fires alerts/recoveries through Telegram on state transitions only.
 */
export function startHeartbeat(bot: Bot, state: AlertState): void {
  const intervalMs = config.HEARTBEAT_INTERVAL_MS;
  const alertThreshold = config.ALERT_GAP_THRESHOLD;
  const recoveryThreshold = config.RECOVERY_GAP_THRESHOLD;

  logger.info(
    { intervalMs, alertThreshold, recoveryThreshold },
    "Heartbeat loop starting",
  );

  const tick = async (): Promise<void> => {
    try {
      const snapshot = await collectAllStatus();

      // ── RPC check ────────────────────────────────
      if (snapshot.rpcHeight === null) {
        if (state.shouldAlertRpcDown()) {
          state.markRpcDown();
          await broadcastAlert(bot, formatRpcDown());
          logger.warn("RPC down alert sent");
        }
        // Can't check DB gaps without RPC — skip DB checks
        return;
      }

      // RPC is up — clear rpc-down state
      if (state.isRpcDown()) {
        state.markRpcUp();
        logger.info("RPC recovered");
      }

      // ── DB checks ────────────────────────────────
      for (const db of snapshot.dbs) {
        // DB is completely unreachable
        if (db.isDown) {
          if (state.shouldAlert(db.label, "down")) {
            state.markAlerted(db.label, "down");
            await broadcastAlert(
              bot,
              formatDownAlert(db.label, db.type),
            );
            logger.warn({ label: db.label }, "DB down alert sent");
          }
          continue;
        }

        // DB responded but is lagging
        if (db.gap !== null && db.gap > alertThreshold) {
          if (state.shouldAlert(db.label, "lagging")) {
            state.markAlerted(db.label, "lagging");
            await broadcastAlert(
              bot,
              formatAlert(db, snapshot.rpcHeight),
            );
            logger.warn(
              { label: db.label, gap: db.gap },
              "DB lag alert sent",
            );
          }
          continue;
        }

        // DB is within acceptable range — check for recovery
        if (
          db.gap !== null &&
          db.gap <= recoveryThreshold &&
          state.shouldRecover(db.label)
        ) {
          state.markRecovered(db.label);
          await broadcastAlert(bot, formatRecovery(db));
          logger.info(
            { label: db.label, gap: db.gap },
            "DB recovery alert sent",
          );
        }
      }

      // ── Disk space check (every tick) ─────────────
      try {
        const serverStats = await collectServerInfo();
        if (serverStats.size > 0) {
          // Check for low disk space
          for (const [host, s] of serverStats) {
            if (s.diskFreePct <= 20 && !diskAlertActive.has(host)) {
              // New alert — fire it
              diskAlertActive.add(host);
              const alertText = formatDiskAlert(serverStats);
              if (alertText) {
                await broadcastAlert(bot, alertText);
                logger.warn({ host, freePct: s.diskFreePct }, "Disk space alert sent");
              }
            } else if (s.diskFreePct > 25 && diskAlertActive.has(host)) {
              // Recovered (with 5% hysteresis to avoid flapping)
              diskAlertActive.delete(host);
              logger.info({ host, freePct: s.diskFreePct }, "Disk space recovered");
            }
          }
        }
      } catch (diskErr: unknown) {
        logger.debug({ err: diskErr }, "Disk check skipped");
      }
    } catch (err: unknown) {
      // Never let the heartbeat crash
      logger.error({ err }, "Heartbeat tick error (non-fatal)");
    }
  };

  // Run first tick immediately, then on interval
  void tick();
  setInterval(() => void tick(), intervalMs);

  logger.info("Heartbeat loop registered");
}
