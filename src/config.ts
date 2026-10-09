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
  RPC_LABEL_01: z.string().default("ZigScan"),
  RPC_URL_02: z.string().url().default("https://cryptocomics-rpc.wickhub.cc"),
  RPC_LABEL_02: z.string().default("CryptoComics"),
  RPC_URL_03: z.string().url().default("https://public-zigchain-rpc.numia.xyz/"),
  RPC_LABEL_03: z.string().default("Numia"),

  // Testnet RPC — used for gap calculation of testnet-labelled DBs
  TESTNET_RPC_URL: z.string().default(""),
  TESTNET_RPC_LABEL: z.string().default("Testnet RPC"),

  // PostgreSQL — 4 instances
  PG_DSN_01: z.string().default(""),
  PG_DSN_02: z.string().default(""),
  PG_DSN_03: z.string().default(""),
  PG_DSN_04: z.string().default(""),
  PG_DSN_05: z.string().default(""),
  PG_DSN_06: z.string().default(""),
  PG_DSN_07: z.string().default(""),
  PG_DSN_08: z.string().default(""),
  PG_DSN_09: z.string().default(""),
  PG_INDEXER_TABLE: z.string().min(1).default("indexer_table"),
  PG_LABEL_01: z.string().default("PG-01"),
  PG_LABEL_02: z.string().default("PG-02"),
  PG_LABEL_03: z.string().default("PG-03"),
  PG_LABEL_04: z.string().default("UAT"),
  PG_LABEL_05: z.string().default("Testnet"),
  PG_LABEL_06: z.string().default("Red Panda Postgres"),
  PG_LABEL_07: z.string().default("PG-07"),
  PG_LABEL_08: z.string().default("PG-08"),
  PG_LABEL_09: z.string().default("PG-09"),

  // Optional shared proxy URL — if set, both ClickHouse clients connect through
  // this URL instead of http://<host>:<port>, while keeping their own db/table/creds.
  CLICKHOUSE_URLS: z.string().default(""),

  // ClickHouse — Instance 01
  // Optional — only added when CH_HOST_01 is set
  CH_HOST_01: z.string().default(""),
  CH_PORT_01: z.coerce.number().int().positive().default(8123),
  CH_USER_01: z.string().default("default"),
  CH_PASS_01: z.string().default(""),
  CH_DB_01: z.string().default("default"),
  CH_TABLE_01: z.string().min(1).default("indexer_table"),
  CH_LABEL_01: z.string().default("CH-01"),

  // ClickHouse — Instance 02 (optional, added when CH_HOST_02 is set)
  CH_HOST_02: z.string().default(""),
  CH_PORT_02: z.coerce.number().int().positive().default(8123),
  CH_USER_02: z.string().default("default"),
  CH_PASS_02: z.string().default(""),
  CH_DB_02: z.string().default("default"),
  CH_TABLE_02: z.string().min(1).default("indexer_table"),
  CH_LABEL_02: z.string().default("CH-02"),

  // ClickHouse — Instances 03, 04, 05 (optional, each added when its CH_HOST_NN is set)
  CH_HOST_03: z.string().default(""),
  CH_PORT_03: z.coerce.number().int().positive().default(8123),
  CH_USER_03: z.string().default("default"),
  CH_PASS_03: z.string().default(""),
  CH_DB_03: z.string().default("default"),
  CH_TABLE_03: z.string().min(1).default("indexer_table"),
  CH_LABEL_03: z.string().default("CH-03"),

  CH_HOST_04: z.string().default(""),
  CH_PORT_04: z.coerce.number().int().positive().default(8123),
  CH_USER_04: z.string().default("default"),
  CH_PASS_04: z.string().default(""),
  CH_DB_04: z.string().default("default"),
  CH_TABLE_04: z.string().min(1).default("indexer_table"),
  CH_LABEL_04: z.string().default("CH-04"),

  CH_HOST_05: z.string().default(""),
  CH_PORT_05: z.coerce.number().int().positive().default(8123),
  CH_USER_05: z.string().default("default"),
  CH_PASS_05: z.string().default(""),
  CH_DB_05: z.string().default("default"),
  CH_TABLE_05: z.string().min(1).default("indexer_table"),
  CH_LABEL_05: z.string().default("CH-05"),

  // Thresholds
  ALERT_GAP_THRESHOLD: z.coerce.number().int().positive().default(500),
  RECOVERY_GAP_THRESHOLD: z.coerce.number().int().positive().default(100),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  CPU_HISTORY_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),
  CPU_AVG_THRESHOLD: z.coerce.number().positive().default(50),

  // Scheduled report (hour in UTC, 0-23. Set to -1 to disable)
  DAILY_REPORT_HOUR: z.coerce.number().int().min(-1).max(23).default(9),

  // Runtime
  NODE_ENV: z.enum(["development", "production"]).default("development"),

  // SSH — for remote server commands (df -h, free -h, etc.)
  SSH_PORT: z.coerce.number().int().positive().default(22),
  SSH_KEY_PATH: z.string().default(""),
  SSH_PASSPHRASE: z.string().default(""),

  // SSH tunnel for Postgres Archive (locally bound on remote server)
  // Set ARCHIVE_SSH_HOST to enable the tunnel for PG_DSN_03.
  ARCHIVE_SSH_HOST: z.string().default(""),
  ARCHIVE_SSH_USER: z.string().default("root"),
  ARCHIVE_REMOTE_PORT: z.coerce.number().int().positive().default(5433),
  ARCHIVE_LOCAL_PORT: z.coerce.number().int().positive().default(15433),

  // SSH tunnel for ClickHouse Primary (locally bound on remote server)
  // Set CH_TUNNEL_SSH_HOST to enable the tunnel for CH instance 01.
  CH_TUNNEL_SSH_HOST: z.string().default(""),
  CH_TUNNEL_SSH_USER: z.string().default("root"),
  CH_TUNNEL_REMOTE_PORT: z.coerce.number().int().positive().default(9090),
  CH_TUNNEL_LOCAL_PORT: z.coerce.number().int().positive().default(19090),

  // SSH tunnel for Testnet Postgres (locally bound on 95.216.44.77:5434)
  // Set TESTNET_SSH_HOST to enable the tunnel for PG_DSN_05.
  TESTNET_SSH_HOST: z.string().default(""),
  TESTNET_SSH_USER: z.string().default("root"),
  TESTNET_SSH_PORT: z.coerce.number().int().positive().default(22),
  TESTNET_REMOTE_PORT: z.coerce.number().int().positive().default(5434),
  TESTNET_LOCAL_PORT: z.coerce.number().int().positive().default(15434),

  // SSH tunnel for Red Panda Postgres (locally bound on 66.206.24.98:6433)
  // Set REDPANDA_SSH_HOST to enable the tunnel for PG_DSN_06.
  REDPANDA_SSH_HOST: z.string().default(""),
  REDPANDA_SSH_USER: z.string().default("root"),
  REDPANDA_SSH_PORT: z.coerce.number().int().positive().default(22),
  REDPANDA_REMOTE_PORT: z.coerce.number().int().positive().default(6433),
  REDPANDA_LOCAL_PORT: z.coerce.number().int().positive().default(16433),
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
