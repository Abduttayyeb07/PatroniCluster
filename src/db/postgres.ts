import postgres, { type Sql } from "postgres";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface PgInstance {
  label: string;
  host: string;
  port: number;
  /** Host/port to TCP-ping. For tunneled instances this is 127.0.0.1:localPort. */
  pingHost: string;
  pingPort: number;
  client: Sql;
  dsn: string;
}

/**
 * Mask password in DSN for safe logging.
 */
function maskDsn(dsn: string): string {
  return dsn.replace(/:([^@]+)@/, ":****@");
}

/**
 * Extract host/IP from a PostgreSQL DSN string.
 */
function extractHost(dsn: string): string {
  try {
    const match = dsn.match(/@([^:/]+)/);
    return match?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Extract port from a PostgreSQL DSN string.
 */
function extractPort(dsn: string): number {
  try {
    const match = dsn.match(/:(\d+)\//);
    return match ? Number(match[1]) : 5432;
  } catch {
    return 5432;
  }
}

/**
 * Create lazy-connect postgres clients for all 3 instances.
 * Logs connection details at startup for debugging.
 */
export function createPgClients(dsnOverrides: Partial<Record<"01" | "02" | "03" | "04" | "05", string>> = {}): PgInstance[] {
  // originalDsn is always the real server DSN (used for host/port display and SSH stats).
  // dsn may be rewritten to a tunnel address for the actual connection.
  const dsns: Array<{ dsn: string; originalDsn: string; label: string }> = [
    { dsn: dsnOverrides["01"] ?? config.PG_DSN_01, originalDsn: config.PG_DSN_01, label: config.PG_LABEL_01 },
    { dsn: dsnOverrides["02"] ?? config.PG_DSN_02, originalDsn: config.PG_DSN_02, label: config.PG_LABEL_02 },
    { dsn: dsnOverrides["03"] ?? config.PG_DSN_03, originalDsn: config.PG_DSN_03, label: config.PG_LABEL_03 },
  ];

  // UAT is optional — only added when PG_DSN_04 is set
  const dsn04 = dsnOverrides["04"] ?? config.PG_DSN_04;
  if (dsn04) {
    dsns.push({ dsn: dsn04, originalDsn: config.PG_DSN_04, label: config.PG_LABEL_04 });
  }

  // Testnet is optional — only added when PG_DSN_05 is set
  const dsn05 = dsnOverrides["05"] ?? config.PG_DSN_05;
  if (dsn05) {
    dsns.push({ dsn: dsn05, originalDsn: config.PG_DSN_05, label: config.PG_LABEL_05 });
  }

  return dsns.map(({ dsn, originalDsn, label }) => {
    const masked = maskDsn(dsn);
    // Always extract host/port from the original DSN so Telegram status and SSH
    // stats show the real server IP, not the tunnel's 127.0.0.1.
    const host = extractHost(originalDsn);
    const port = extractPort(originalDsn);
    // For tunneled instances, ping the local tunnel endpoint instead of the
    // real host (which is locally bound and unreachable externally).
    const isTunneled = dsn !== originalDsn;
    const pingHost = isTunneled ? extractHost(dsn) : host;
    const pingPort = isTunneled ? extractPort(dsn) : port;
    logger.info(
      { label, dsn: masked, table: config.PG_INDEXER_TABLE },
      `PG client created → ${masked}`,
    );

    return {
      label,
      host,
      port,
      pingHost,
      pingPort,
      dsn,
      client: postgres(dsn, {
        max: 2,
        idle_timeout: 30,
        connect_timeout: 10,
      }),
    };
  });
}

/**
 * Fetch the maximum height from the indexer table.
 * Never throws — catches all errors and returns null.
 */
export async function fetchPgHeight(
  client: Sql,
  label: string,
): Promise<number | null> {
  try {
    const table = config.PG_INDEXER_TABLE;
    const query = `SELECT MAX(height) AS height FROM ${table}`;
    logger.debug({ label, query }, "PG height query executing");

    const rows = await client.unsafe(query);
    const row = rows[0];
    if (!row || row["height"] === null || row["height"] === undefined) {
      logger.warn({ label }, "PG height query returned null");
      return null;
    }
    const height = Number(row["height"]);
    if (Number.isNaN(height)) {
      logger.warn({ label, raw: row["height"] }, "PG height parse failed");
      return null;
    }
    logger.info({ label, height }, "PG height fetched ✓");
    return height;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown PG error";
    logger.error({ label, err: msg }, `PG height fetch failed: ${msg}`);
    return null;
  }
}

/**
 * Fetch the database size in human-readable format.
 * Never throws — catches all errors and returns null.
 */
export async function fetchPgSize(
  client: Sql,
  label: string,
): Promise<string | null> {
  try {
    const rows = await client`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size
    `;
    const row = rows[0];
    if (!row || row["size"] === null || row["size"] === undefined) {
      return null;
    }
    return String(row["size"]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown PG error";
    logger.error({ label, err: msg }, `PG size fetch failed: ${msg}`);
    return null;
  }
}

/**
 * Fetch disk/storage info from PostgreSQL.
 * Gets total size of all databases on the server + data directory size.
 */
export async function fetchPgDiskInfo(
  client: Sql,
  label: string,
): Promise<{ total: string; dbUsed: string } | null> {
  try {
    const rows = await client`
      SELECT
        pg_size_pretty(sum(pg_database_size(datname))) AS db_used,
        pg_size_pretty(pg_tablespace_size('pg_default')) AS total
      FROM pg_database
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      total: String(row["total"] ?? "N/A"),
      dbUsed: String(row["db_used"] ?? "N/A"),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown PG error";
    logger.error({ label, err: msg }, `PG disk info failed: ${msg}`);
    return null;
  }
}

/**
 * Gracefully close all PG connections.
 */
export async function closePgClients(instances: PgInstance[]): Promise<void> {
  await Promise.allSettled(
    instances.map(async ({ client, label }) => {
      try {
        await client.end({ timeout: 5 });
        logger.info({ label }, "PG connection closed");
      } catch (err: unknown) {
        logger.error({ label, err }, "Error closing PG connection");
      }
    }),
  );
}
