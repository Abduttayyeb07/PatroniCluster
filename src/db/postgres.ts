import postgres, { type Sql } from "postgres";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface PgInstance {
  label: string;
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
 * Create lazy-connect postgres clients for all 3 instances.
 * Logs connection details at startup for debugging.
 */
export function createPgClients(): PgInstance[] {
  const dsns: Array<{ dsn: string; label: string }> = [
    { dsn: config.PG_DSN_01, label: "PG-01" },
    { dsn: config.PG_DSN_02, label: "PG-02" },
    { dsn: config.PG_DSN_03, label: "PG-03" },
  ];

  return dsns.map(({ dsn, label }) => {
    const masked = maskDsn(dsn);
    logger.info(
      { label, dsn: masked, table: config.PG_INDEXER_TABLE },
      `PG client created → ${masked}`,
    );

    return {
      label,
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
