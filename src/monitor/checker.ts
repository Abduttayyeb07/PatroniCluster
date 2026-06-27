import { fetchAllRpcHeights, type RpcEndpointResult } from "../rpc.js";
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
  /** Canonical height used for gap calculations (primary RPC, or first available fallback) */
  rpcHeight: number | null;
  rpcLatencyMs: number;
  /** All RPC endpoint results for display/comparison */
  rpcs: RpcEndpointResult[];
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
 * Wraps a promise with a hard deadline. Returns fallback if the promise doesn't
 * settle in time. Prevents firewall-dropped TCP connections from hanging forever
 * (connect_timeout only fires after the connection is established; a DROP rule
 * means the SYN never gets a response and the OS retransmit timer (~2 min) runs).
 */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Collect sync status from ALL databases + all RPCs + TCP pings concurrently.
 * Never throws — individual failures result in null heights.
 */
export async function collectAllStatus(): Promise<SyncSnapshot> {
  const pgPingTargets = pgInstances.map((pg) => ({ host: pg.pingHost, port: pg.pingPort }));
  const chPingTargets = chInstances.map((ch) => ({ host: ch.host, port: 8123 }));

  // Run all RPC fetches + DB pings + DB heights in parallel
  const [rpcs, ...rest] = await Promise.all([
    fetchAllRpcHeights(),
    // PG pings
    ...pgPingTargets.map((t) => tcpPing(t.host, t.port)),
    // CH pings
    ...chPingTargets.map((t) => tcpPing(t.host, t.port)),
    // PG heights — capped at FETCH_TIMEOUT_MS so a hung TCP SYN doesn't stall the UI
    ...pgInstances.map((pg) => withTimeout(fetchPgHeight(pg.client, pg.label), FETCH_TIMEOUT_MS, null)),
    // CH heights
    ...chInstances.map((ch) => withTimeout(fetchChHeight(ch.client, ch.database, ch.table, ch.label), FETCH_TIMEOUT_MS, null)),
  ]);

  const allRpcs = rpcs as RpcEndpointResult[];

  // Canonical height: primary RPC first, then first available fallback
  let rpcHeight: number | null = allRpcs[0]?.height ?? null;
  let rpcLatencyMs: number = allRpcs[0]?.latencyMs ?? 0;
  if (rpcHeight === null) {
    for (const rpc of allRpcs.slice(1)) {
      if (rpc.height !== null) {
        rpcHeight = rpc.height;
        rpcLatencyMs = rpc.latencyMs;
        break;
      }
    }
  }

  const pgCount = pgInstances.length;
  const chCount = chInstances.length;
  const totalPings = pgCount + chCount;

  const pgPings = rest.slice(0, pgCount) as PingResult[];
  const chPings = rest.slice(pgCount, totalPings) as PingResult[];
  const pgHeights = rest.slice(totalPings, totalPings + pgCount) as Array<number | null>;
  const chHeights = rest.slice(totalPings + pgCount) as Array<number | null>;

  const dbs: DbStatus[] = [];

  pgInstances.forEach((pg, i) => {
    const ping = pgPings[i];
    const height = pgHeights[i] ?? null;
    const gap = rpcHeight !== null && height !== null ? rpcHeight - height : null;
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

  chInstances.forEach((ch, i) => {
    const ping = chPings[i];
    const height = chHeights[i] ?? null;
    const gap = rpcHeight !== null && height !== null ? rpcHeight - height : null;
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
    rpcLatencyMs,
    rpcs: allRpcs,
    dbs,
    timestamp: new Date(),
  };

  logger.info(
    {
      rpcHeight,
      rpcLatencyMs,
      rpcCount: allRpcs.length,
      dbCount: dbs.length,
      downCount: dbs.filter((d) => d.isDown).length,
    },
    "Status collection complete",
  );

  return snapshot;
}

/**
 * Collect database sizes from all databases concurrently.
 */
export async function collectAllSizes(): Promise<Record<string, string | null>> {
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

  await Promise.all(
    pgInstances.map(async (pg) => {
      const ping = await tcpPing(pg.host, pg.port);
      const qStart = performance.now();
      await fetchPgHeight(pg.client, pg.label);
      const queryMs = Math.round(performance.now() - qStart);
      results.push({ label: pg.label, host: pg.host, port: pg.port, pingOk: ping.ok, pingMs: ping.latencyMs, queryMs });
    }),
  );

  await Promise.all(
    chInstances.map(async (ch) => {
      const ping = await tcpPing(ch.host, 8123);
      const qStart = performance.now();
      await fetchChHeight(ch.client, ch.database, ch.table, ch.label);
      const queryMs = Math.round(performance.now() - qStart);
      results.push({ label: ch.label, host: ch.host, port: 8123, pingOk: ping.ok, pingMs: ping.latencyMs, queryMs });
    }),
  );

  return results;
}

import { collectAllServerStats, type ServerStats } from "../utils/ssh.js";

export function getAllHosts(): string[] {
  const hosts: string[] = [];
  for (const pg of pgInstances) hosts.push(pg.host);
  for (const ch of chInstances) hosts.push(ch.host);
  const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
  return [...new Set(hosts)].filter((h) => !LOOPBACK.has(h));
}

export async function collectServerInfo(): Promise<Map<string, ServerStats>> {
  return collectAllServerStats(getAllHosts());
}
