import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface ChInstance {
  label: string;
  host: string;
  client: ClickHouseClient;
  database: string;
  table: string;
}

/**
 * Create ClickHouse clients for both instances.
 * Logs connection details at startup for debugging.
 */
export function createChClients(): ChInstance[] {
  const configs = [
    {
      label: config.CH_LABEL_01,
      host: config.CH_HOST_01,
      port: config.CH_PORT_01,
      user: config.CH_USER_01,
      password: config.CH_PASS_01,
      database: config.CH_DB_01,
      table: config.CH_TABLE_01,
    },
    {
      label: config.CH_LABEL_02,
      host: config.CH_HOST_02,
      port: config.CH_PORT_02,
      user: config.CH_USER_02,
      password: config.CH_PASS_02,
      database: config.CH_DB_02,
      table: config.CH_TABLE_02,
    },
  ];

  return configs.map(({ label, host, port, user, password, database, table }) => {
    const url = `http://${host}:${port}`;
    logger.info(
      { label, url, user, database, table },
      `CH client created → ${url} (db: ${database}, table: ${table})`,
    );

    return {
      label,
      host,
      database,
      table,
      client: createClient({
        url,
        username: user,
        password,
        database,
        request_timeout: 10_000,
        clickhouse_settings: {
          connect_timeout: 10,
        },
      }),
    };
  });
}

/**
 * Fetch the maximum height from the given ClickHouse table.
 * Never throws — catches all errors and returns null.
 */
export async function fetchChHeight(
  client: ClickHouseClient,
  table: string,
  label: string,
): Promise<number | null> {
  try {
    const query = `SELECT MAX(height) AS height FROM ${table}`;
    logger.debug({ label, query }, "CH height query executing");

    const resultSet = await client.query({
      query,
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ height: string | number }>();
    const row = rows[0];
    if (!row || row.height === null || row.height === undefined) {
      logger.warn({ label }, "CH height query returned null");
      return null;
    }
    const height = Number(row.height);
    if (Number.isNaN(height)) {
      logger.warn({ label, raw: row.height }, "CH height parse failed");
      return null;
    }
    logger.debug({ label, height }, "CH height fetched");
    return height;
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    const msg = err instanceof Error
      ? err.message
      : String(errObj?.["message"] ?? errObj?.["code"] ?? "Unknown CH error");
    const code = errObj?.["code"] ?? "UNKNOWN";
    logger.error({ label, err: msg, code }, `CH height fetch failed: ${msg}`);
    return null;
  }
}

/**
 * Fetch the database size in human-readable format from ClickHouse system.parts.
 * Never throws — catches all errors and returns null.
 */
export async function fetchChSize(
  client: ClickHouseClient,
  database: string,
  label: string,
): Promise<string | null> {
  try {
    const resultSet = await client.query({
      query: `
        SELECT formatReadableSize(sum(bytes_on_disk)) AS size
        FROM system.parts
        WHERE database = {database:String}
        AND active
      `,
      format: "JSONEachRow",
      query_params: { database },
    });
    const rows = await resultSet.json<{ size: string }>();
    const row = rows[0];
    if (!row || !row.size) {
      return null;
    }
    return row.size;
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    const msg = err instanceof Error
      ? err.message
      : String(errObj?.["message"] ?? errObj?.["code"] ?? "Unknown CH error");
    logger.error({ label, err: msg }, `CH size fetch failed: ${msg}`);
    return null;
  }
}

/**
 * Fetch disk space info from ClickHouse system.disks table.
 * Returns total, free, and used space in human-readable format.
 */
export async function fetchChDiskInfo(
  client: ClickHouseClient,
  label: string,
): Promise<{ total: string; free: string; used: string } | null> {
  try {
    const resultSet = await client.query({
      query: `
        SELECT
          formatReadableSize(total_space) AS total,
          formatReadableSize(free_space) AS free,
          formatReadableSize(total_space - free_space) AS used
        FROM system.disks
        WHERE name = 'default'
        LIMIT 1
      `,
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ total: string; free: string; used: string }>();
    const row = rows[0];
    if (!row) return null;
    return { total: row.total, free: row.free, used: row.used };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown CH error";
    logger.error({ label, err: msg }, `CH disk info failed: ${msg}`);
    return null;
  }
}

/**
 * Gracefully close all ClickHouse connections.
 */
export async function closeChClients(instances: ChInstance[]): Promise<void> {
  await Promise.allSettled(
    instances.map(async ({ client, label }) => {
      try {
        await client.close();
        logger.info({ label }, "CH connection closed");
      } catch (err: unknown) {
        logger.error({ label, err }, "Error closing CH connection");
      }
    }),
  );
}
