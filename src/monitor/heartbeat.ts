import type { Bot } from "grammy";
import { config } from "../config.js";
import { collectAllStatus } from "./checker.js";
import { AlertState } from "./state.js";
import {
  formatAlert,
  formatDownAlert,
  formatRecovery,
  formatRpcDown,
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
