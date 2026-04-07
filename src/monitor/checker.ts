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
import { tcpPing, type PingResult } from "../utils/ping.js";
import { logger } from "../utils/logger.js";

export interface DbStatus {
  label: string;
  type: "PostgreSQL" | "ClickHouse";
  host: string;
  port: number;
  pingOk: boolean;
  pingMs: number;
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
 * Build a list of unique host:port targets to ping (deduplicates shared servers).
 */
function getUniquePingTargets(): Array<{ host: string; port: number }> {
  const seen = new Set<string>();
  const targets: Array<{ host: string; port: number }> = [];

  for (const pg of pgInstances) {
    const key = `${pg.host}:${pg.port}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ host: pg.host, port: pg.port });
    }
  }
  for (const ch of chInstances) {
    const port = Number(ch.host === chInstances[0]?.host ? chInstances[0] : ch);
    // CH uses HTTP port
    const chPort = ch.host === pgInstances[0]?.host
      ? 8123
      : 8123; // all CH use 8123
    const key = `${ch.host}:${chPort}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ host: ch.host, port: chPort });
    }
  }

  return targets;
}

/**
 * Collect sync status from ALL 5 databases + RPC + TCP pings concurrently.
 * Never throws — individual failures result in null heights.
 */
export async function collectAllStatus(): Promise<SyncSnapshot> {
  // Build ping targets for all instances
  const pgPingTargets = pgInstances.map((pg) => ({ host: pg.host, port: pg.port }));
  const chPingTargets = chInstances.map((ch) => {
    // Extract port from the CH config (HTTP port)
    const portMatch = ch.host; // host is just the IP
    return { host: ch.host, port: 8123 };
  });

  const [rpcResult, ...rest] = await Promise.all([
    fetchRpcHeight(),
    // PG pings
    ...pgPingTargets.map((t) => tcpPing(t.host, t.port)),
    // CH pings
    ...chPingTargets.map((t) => tcpPing(t.host, t.port)),
    // PG heights
    ...pgInstances.map((pg) => fetchPgHeight(pg.client, pg.label)),
    // CH heights
    ...chInstances.map((ch) =>
      fetchChHeight(ch.client, ch.table, ch.label),
    ),
  ]);

  const rpc = rpcResult as RpcResult;
  const rpcHeight = rpc.height;

  const pgCount = pgInstances.length;
  const chCount = chInstances.length;
  const totalPings = pgCount + chCount;

  // Split out results
  const pgPings = rest.slice(0, pgCount) as PingResult[];
  const chPings = rest.slice(pgCount, totalPings) as PingResult[];
  const pgHeights = rest.slice(totalPings, totalPings + pgCount) as Array<number | null>;
  const chHeights = rest.slice(totalPings + pgCount) as Array<number | null>;

  const dbs: DbStatus[] = [];

  // Map PG results
  pgInstances.forEach((pg, i) => {
    const ping = pgPings[i];
    const height = pgHeights[i] ?? null;
    const gap =
      rpcHeight !== null && height !== null ? rpcHeight - height : null;
    dbs.push({
      label: pg.label,
      type: "PostgreSQL",
      host: pg.host,
      port: pg.port,
      pingOk: ping?.ok ?? false,
      pingMs: ping?.latencyMs ?? -1,
      height,
      gap,
      isDown: height === null,
    });
  });

  // Map CH results
  chInstances.forEach((ch, i) => {
    const ping = chPings[i];
    const height = chHeights[i] ?? null;
    const gap =
      rpcHeight !== null && height !== null ? rpcHeight - height : null;
    dbs.push({
      label: ch.label,
      type: "ClickHouse",
      host: ch.host,
      port: 8123,
      pingOk: ping?.ok ?? false,
      pingMs: ping?.latencyMs ?? -1,
      height,
      gap,
      isDown: height === null,
    });
  });

  const snapshot: SyncSnapshot = {
    rpcHeight,
    rpcLatencyMs: rpc.latencyMs,
    dbs,
    timestamp: new Date(),
  };

  logger.info(
    {
      rpcHeight,
      rpcLatencyMs: rpc.latencyMs,
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

/**
 * Collect latency details for all DB connections.
 * Returns per-DB ping + query latency.
 */
export async function collectLatency(): Promise<
  Array<{
    label: string;
    host: string;
    port: number;
    pingOk: boolean;
    pingMs: number;
    queryMs: number;
  }>
> {
  const results: Array<{
    label: string;
    host: string;
    port: number;
    pingOk: boolean;
    pingMs: number;
    queryMs: number;
  }> = [];

  // PG latency
  await Promise.all(
    pgInstances.map(async (pg) => {
      const ping = await tcpPing(pg.host, pg.port);
      const qStart = performance.now();
      await fetchPgHeight(pg.client, pg.label);
      const queryMs = Math.round(performance.now() - qStart);
      results.push({
        label: pg.label,
        host: pg.host,
        port: pg.port,
        pingOk: ping.ok,
        pingMs: ping.latencyMs,
        queryMs,
      });
    }),
  );

  // CH latency
  await Promise.all(
    chInstances.map(async (ch) => {
      const ping = await tcpPing(ch.host, 8123);
      const qStart = performance.now();
      await fetchChHeight(ch.client, ch.table, ch.label);
      const queryMs = Math.round(performance.now() - qStart);
      results.push({
        label: ch.label,
        host: ch.host,
        port: 8123,
        pingOk: ping.ok,
        pingMs: ping.latencyMs,
        queryMs,
      });
    }),
  );

  return results;
}
