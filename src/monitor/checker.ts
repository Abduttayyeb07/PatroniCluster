import { fetchRpcHeight, type RpcResult } from "../rpc.js";
import {
  type PgInstance,
  fetchPgHeight,
  fetchPgSize,
} from "../db/postgres.js";
import {
  type ChInstance,
  fetchChHeight,
  fetchChSize,
} from "../db/clickhouse.js";
import { logger } from "../utils/logger.js";

export interface DbStatus {
  label: string;
  type: "PostgreSQL" | "ClickHouse";
  height: number | null;
  gap: number | null;
  isDown: boolean;
}

export interface SyncSnapshot {
  rpcHeight: number | null;
  rpcLatencyMs: number;
  dbs: DbStatus[];
  timestamp: Date;
}

/** Module-level references set at init */
let pgInstances: PgInstance[] = [];
let chInstances: ChInstance[] = [];

/**
 * Initialize the checker with DB client references.
 * Must be called once at startup before any collect* calls.
 */
export function initChecker(pg: PgInstance[], ch: ChInstance[]): void {
  pgInstances = pg;
  chInstances = ch;
}

/**
 * Collect sync status from ALL 5 databases + RPC concurrently.
 * Never throws — individual failures result in null heights.
 */
export async function collectAllStatus(): Promise<SyncSnapshot> {
  const [rpcResult, ...dbHeights] = await Promise.all([
    fetchRpcHeight(),
    // PG heights
    ...pgInstances.map((pg) => fetchPgHeight(pg.client, pg.label)),
    // CH heights
    ...chInstances.map((ch) =>
      fetchChHeight(ch.client, ch.table, ch.label),
    ),
  ]) as [RpcResult, ...Array<number | null>];

  const rpcHeight = rpcResult.height;

  const dbs: DbStatus[] = [];

  // Map PG results
  pgInstances.forEach((pg, i) => {
    const height = dbHeights[i] ?? null;
    const gap =
      rpcHeight !== null && height !== null ? rpcHeight - height : null;
    dbs.push({
      label: pg.label,
      type: "PostgreSQL",
      height,
      gap,
      isDown: height === null,
    });
  });

  // Map CH results
  chInstances.forEach((ch, i) => {
    const height = dbHeights[pgInstances.length + i] ?? null;
    const gap =
      rpcHeight !== null && height !== null ? rpcHeight - height : null;
    dbs.push({
      label: ch.label,
      type: "ClickHouse",
      height,
      gap,
      isDown: height === null,
    });
  });

  const snapshot: SyncSnapshot = {
    rpcHeight,
    rpcLatencyMs: rpcResult.latencyMs,
    dbs,
    timestamp: new Date(),
  };

  logger.info(
    {
      rpcHeight,
      rpcLatencyMs: rpcResult.latencyMs,
      dbCount: dbs.length,
      downCount: dbs.filter((d) => d.isDown).length,
    },
    "Status collection complete",
  );

  return snapshot;
}

/**
 * Collect database sizes from ALL 5 databases concurrently.
 * Returns a record mapping label → size string (or null on failure).
 */
export async function collectAllSizes(): Promise<
  Record<string, string | null>
> {
  const results = await Promise.all([
    ...pgInstances.map(async (pg) => ({
      label: pg.label,
      size: await fetchPgSize(pg.client, pg.label),
    })),
    ...chInstances.map(async (ch) => ({
      label: ch.label,
      size: await fetchChSize(ch.client, ch.database, ch.label),
    })),
  ]);

  const sizes: Record<string, string | null> = {};
  for (const { label, size } of results) {
    sizes[label] = size;
  }

  logger.debug({ sizes }, "Size collection complete");
  return sizes;
}
