import "dotenv/config";
import { z } from "zod";

/**
 * Zod schema for all environment variables.
 * Parses comma-separated ID lists into number arrays.
 */
const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string()
    .min(1, "TELEGRAM_BOT_TOKEN is required"),

  ALLOWED_USER_IDS: z
    .string()
    .min(1, "ALLOWED_USER_IDS is required")
    .transform((val) =>
      val.split(",").map((id) => {
        const parsed = Number(id.trim());
        if (Number.isNaN(parsed)) {
          throw new Error(`Invalid user ID: "${id.trim()}"`);
        }
        return parsed;
      }),
    ),

  ALERT_CHAT_IDS: z
    .string()
    .min(1, "ALERT_CHAT_IDS is required")
    .transform((val) =>
      val.split(",").map((id) => {
        const parsed = Number(id.trim());
        if (Number.isNaN(parsed)) {
          throw new Error(`Invalid chat ID: "${id.trim()}"`);
        }
        return parsed;
      }),
    ),

  RPC_URL: z
    .string()
    .url("RPC_URL must be a valid URL")
    .default("https://zigchain-mainnet.zigscan.net"),

  // PostgreSQL — 3 instances
  PG_DSN_01: z.string().min(1, "PG_DSN_01 is required"),
  PG_DSN_02: z.string().min(1, "PG_DSN_02 is required"),
  PG_DSN_03: z.string().min(1, "PG_DSN_03 is required"),
  PG_INDEXER_TABLE: z.string().min(1).default("indexer_table"),
  PG_LABEL_01: z.string().default("PG-01"),
  PG_LABEL_02: z.string().default("PG-02"),
  PG_LABEL_03: z.string().default("PG-03"),

  // ClickHouse — Instance 01
  CH_HOST_01: z.string().min(1, "CH_HOST_01 is required"),
  CH_PORT_01: z.coerce.number().int().positive().default(8123),
  CH_USER_01: z.string().default("default"),
  CH_PASS_01: z.string().default(""),
  CH_DB_01: z.string().default("default"),
  CH_TABLE_01: z.string().min(1).default("indexer_table"),
  CH_LABEL_01: z.string().default("CH-01"),

  // ClickHouse — Instance 02
  CH_HOST_02: z.string().min(1, "CH_HOST_02 is required"),
  CH_PORT_02: z.coerce.number().int().positive().default(8123),
  CH_USER_02: z.string().default("default"),
  CH_PASS_02: z.string().default(""),
  CH_DB_02: z.string().default("default"),
  CH_TABLE_02: z.string().min(1).default("indexer_table"),
  CH_LABEL_02: z.string().default("CH-02"),

  // Thresholds
  ALERT_GAP_THRESHOLD: z.coerce.number().int().positive().default(500),
  RECOVERY_GAP_THRESHOLD: z.coerce.number().int().positive().default(100),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),

  // Scheduled report (hour in UTC, 0-23. Set to -1 to disable)
  DAILY_REPORT_HOUR: z.coerce.number().int().min(-1).max(23).default(9),

  // Runtime
  NODE_ENV: z.enum(["development", "production"]).default("development"),

  // SSH — for remote server commands (df -h, free -h, etc.)
  SSH_PORT: z.coerce.number().int().positive().default(22),
  SSH_KEY_PATH: z.string().default(""),
  SSH_PASSPHRASE: z.string().default(""),
});

export type Settings = z.infer<typeof envSchema>;

function loadConfig(): Settings {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✖ ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    console.error(
      `\n═══ Configuration Error ═══\nThe following environment variables are invalid or missing:\n${formatted}\n`,
    );
    process.exit(1);
  }

  return result.data;
}

/** Validated, typed configuration singleton */
export const config: Settings = loadConfig();
