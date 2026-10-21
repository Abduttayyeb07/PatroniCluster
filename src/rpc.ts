import { config } from "./config.js";
import { logger } from "./utils/logger.js";

export interface RpcResult {
  height: number | null;
  latencyMs: number;
  error?: string;
}

export interface RpcEndpointResult extends RpcResult {
  label: string;
  url: string;
}

interface RpcStatusResponse {
  result?: {
    sync_info?: {
      latest_block_height?: string;
    };
  };
}

/** Status paths tried in order — some RPC gateways expose it at /status, others at /cc/status. */
const STATUS_PATHS = ["/status", "/cc/status"];

/**
 * GET <base><path> with a 10s deadline. Throws on network error/timeout.
 */
async function getStatus(base: string, path: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`${base}${path}`, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the latest block height from a single RPC URL. Never throws.
 * Tries /status first and falls back to /cc/status when the first path is a 404.
 */
async function fetchRpcHeightFrom(url: string, label: string): Promise<RpcEndpointResult> {
  const start = performance.now();
  // Strip trailing slashes so "https://host/" doesn't produce "https://host//status"
  const base = url.replace(/\/+$/, "");

  try {
    let response: Response | null = null;
    for (const path of STATUS_PATHS) {
      response = await getStatus(base, path);
      if (response.status !== 404) break;
      logger.debug({ label, path }, "RPC status path returned 404, trying next");
    }

    if (!response || !response.ok) {
      const latencyMs = Math.round(performance.now() - start);
      const errMsg = `HTTP ${response?.status ?? "no response"}`;
      logger.warn({ label, latencyMs, status: response?.status }, "RPC HTTP error");
      return { label, url, height: null, latencyMs, error: errMsg };
    }

    const data = (await response.json()) as RpcStatusResponse;
    const latencyMs = Math.round(performance.now() - start);

    const rawHeight = data?.result?.sync_info?.latest_block_height;
    if (rawHeight === undefined || rawHeight === null) {
      return { label, url, height: null, latencyMs, error: "Missing latest_block_height" };
    }

    const height = parseInt(rawHeight, 10);
    if (Number.isNaN(height)) {
      return { label, url, height: null, latencyMs, error: `Bad height: "${rawHeight}"` };
    }

    logger.debug({ label, height, latencyMs }, "RPC height fetched");
    return { label, url, height, latencyMs };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    logger.warn({ label, err: errMsg }, "RPC fetch failed");
    return { label, url, height: null, latencyMs: 0, error: errMsg };
  }
}

/**
 * Fetch the primary RPC height only. Used by the heartbeat for its RPC-down check.
 */
export async function fetchRpcHeight(): Promise<RpcResult> {
  const { height, latencyMs, error } = await fetchRpcHeightFrom(config.RPC_URL, config.RPC_LABEL_01);
  return { height, latencyMs, error };
}

/**
 * Fetch all 3 mainnet RPC endpoints concurrently and return each result with its label/url.
 */
export async function fetchAllRpcHeights(): Promise<RpcEndpointResult[]> {
  return Promise.all([
    fetchRpcHeightFrom(config.RPC_URL, config.RPC_LABEL_01),
    fetchRpcHeightFrom(config.RPC_URL_02, config.RPC_LABEL_02),
    fetchRpcHeightFrom(config.RPC_URL_03, config.RPC_LABEL_03),
  ]);
}

/**
 * Fetch the testnet RPC height. Returns null result if TESTNET_RPC_URL is not configured.
 */
export async function fetchTestnetRpcHeight(): Promise<RpcEndpointResult | null> {
  if (!config.TESTNET_RPC_URL) return null;
  return fetchRpcHeightFrom(config.TESTNET_RPC_URL, config.TESTNET_RPC_LABEL);
}
