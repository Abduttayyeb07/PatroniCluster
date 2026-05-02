import type { Bot } from "grammy";
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../config.js";
import { collectAllStatus, collectServerInfo } from "./checker.js";
import { formatDailyReport } from "../utils/format.js";
import { logger } from "../utils/logger.js";

const REPORT_STATE_FILE = process.env.REPORT_STATE_FILE ?? "/tmp/daily_report_state.json";

function loadLastReportDate(): string {
  try {
    const raw = readFileSync(REPORT_STATE_FILE, "utf8");
    const obj = JSON.parse(raw) as { lastReportDate?: string };
    return obj.lastReportDate ?? "";
  } catch {
    return "";
  }
}

function saveLastReportDate(date: string): void {
  try {
    writeFileSync(REPORT_STATE_FILE, JSON.stringify({ lastReportDate: date }), "utf8");
  } catch (err: unknown) {
    logger.debug({ err }, "Failed to persist daily report state");
  }
}

/**
 * Send a MarkdownV2 message to ALL alert chat IDs.
 */
async function broadcastReport(bot: Bot, text: string): Promise<void> {
  await Promise.allSettled(
    config.ALERT_CHAT_IDS.map(async (chatId) => {
      try {
        await bot.api.sendMessage(chatId, text, {
          parse_mode: "MarkdownV2",
        });
      } catch (err: unknown) {
        logger.error({ chatId, err }, "Failed to send daily report");
      }
    }),
  );
}

/**
 * Start the daily report scheduler.
 * Checks every 60s if it's the configured hour (UTC).
 * Sends one report per day at DAILY_REPORT_HOUR.
 */
export function startDailyReport(bot: Bot): void {
  const reportHour = config.DAILY_REPORT_HOUR;

  if (reportHour < 0) {
    logger.info("Daily report disabled (DAILY_REPORT_HOUR = -1)");
    return;
  }

  let lastReportDate = loadLastReportDate();

  logger.info({ reportHour }, "Daily report scheduler started");

  setInterval(async () => {
    try {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

      // Only fire once per day, at the configured hour
      if (currentHour !== reportHour || lastReportDate === todayStr) {
        return;
      }

      lastReportDate = todayStr;
      saveLastReportDate(todayStr);
      logger.info({ date: todayStr, hour: reportHour }, "Generating daily report");

      // Collect all data
      const [snapshot, serverStats] = await Promise.all([
        collectAllStatus(),
        collectServerInfo(),
      ]);

      const reportText = formatDailyReport(snapshot, serverStats);
      await broadcastReport(bot, reportText);

      logger.info("Daily report sent successfully");
    } catch (err: unknown) {
      logger.error({ err }, "Daily report error (non-fatal)");
    }
  }, 60_000); // Check every minute
}
