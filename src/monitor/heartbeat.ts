import type { Bot } from "grammy";
import { readFileSync, writeFileSync } from "node:fs";
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

const DISK_STATE_FILE = process.env.DISK_STATE_FILE ?? "/tmp/disk_alert_state.json";

/** host → true if a disk alert is currently active for that host */
const diskAlertActive = new Map<string, boolean>();

function loadDiskState(): void {
  try {
    const raw = readFileSync(DISK_STATE_FILE, "utf8");
    const obj = JSON.parse(raw) as Record<string, boolean>;
    for (const [host, active] of Object.entries(obj)) {
      diskAlertActive.set(host, Boolean(active));
    }
    logger.info({ file: DISK_STATE_FILE, hosts: [...diskAlertActive.keys()] }, "Disk alert state loaded from file");
  } catch {
    // File not found or invalid — start fresh, that's fine
  }
}

function saveDiskState(): void {
  try {
    const obj: Record<string, boolean> = Object.fromEntries(diskAlertActive);
    writeFileSync(DISK_STATE_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (err: unknown) {
    logger.debug({ err }, "Failed to persist disk alert state");
  }
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

  loadDiskState();

  logger.info(
    { intervalMs, alertThreshold, recoveryThreshold },
    "Heartbeat loop starting",
  );

  const tick = async (): Promise<void> => {
    try {
      const snapshot = await collectAllStatus();

      // ── RPC check (mainnet) ───────────────────────
      const mainnetRpcDown = snapshot.rpcHeight === null;
      if (mainnetRpcDown) {
        if (state.shouldAlertRpcDown()) {
          state.markRpcDown();
          await broadcastAlert(bot, formatRpcDown(snapshot.rpcs));
          logger.warn("RPC down alert sent");
        }
      } else if (state.isRpcDown()) {
        // RPC is up — clear rpc-down state
        state.markRpcUp();
        logger.info("RPC recovered");
      }

      // ── DB checks ────────────────────────────────
      // Testnet DBs are gapped against the testnet RPC, so mainnet being down
      // doesn't block their checks — only skip a DB if its own reference RPC is down.
      for (const db of snapshot.dbs) {
        const isTestnet = db.label.toLowerCase().includes("testnet");
        const refRpcDown = isTestnet ? snapshot.testnetRpcHeight === null : mainnetRpcDown;
        if (refRpcDown) continue;

        // DB is completely unreachable
        if (db.isDown) {
          if (state.shouldAlert(db.label, "down")) {
            state.markAlerted(db.label, "down");
            await broadcastAlert(
              bot,
              formatDownAlert(db.label, db.type, db.host),
            );
            logger.warn({ label: db.label }, "DB down alert sent");
          }
          continue;
        }

        // DB responded but is lagging
        if (db.gap !== null && db.gap > alertThreshold) {
          if (state.shouldAlert(db.label, "lagging")) {
            state.markAlerted(db.label, "lagging");
            // refRpcDown already ruled out null here — safe to assert non-null
            const refHeight = (isTestnet ? snapshot.testnetRpcHeight : snapshot.rpcHeight) as number;
            await broadcastAlert(
              bot,
              formatAlert(db, refHeight),
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
            const wasActive = diskAlertActive.get(host) ?? false;

            if (s.diskFreePct <= 20 && !wasActive) {
              diskAlertActive.set(host, true);
              saveDiskState();
              const alertText = formatDiskAlert(serverStats);
              if (alertText) {
                await broadcastAlert(bot, alertText);
                logger.warn({ host, freePct: s.diskFreePct }, "Disk space alert sent");
              }
            } else if (s.diskFreePct > 25 && wasActive) {
              // Recovered — 5% hysteresis to avoid flapping
              diskAlertActive.set(host, false);
              saveDiskState();
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
