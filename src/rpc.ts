import { config } from "./config.js";
import { logger } from "./utils/logger.js";

export interface RpcResult {
  height: number | null;
  latencyMs: number;
  error?: string;
}

/**
 * RPC response shape from Tendermint/CometBFT /status endpoint.
 */
interface RpcStatusResponse {
  result?: {
    sync_info?: {
      latest_block_height?: string;
    };
  };
}

/**
 * Fetch the latest block height from the ZigChain RPC endpoint.
 * Uses a 10-second timeout via AbortController. Never throws.
 */
export async function fetchRpcHeight(): Promise<RpcResult> {
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const url = `${config.RPC_URL}/status`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      const latencyMs = Math.round(performance.now() - start);
      const errMsg = `RPC returned HTTP ${response.status}`;
      logger.warn({ latencyMs, status: response.status }, errMsg);
      return { height: null, latencyMs, error: errMsg };
    }

    const data = (await response.json()) as RpcStatusResponse;
    const latencyMs = Math.round(performance.now() - start);

    const rawHeight = data?.result?.sync_info?.latest_block_height;
    if (rawHeight === undefined || rawHeight === null) {
      const errMsg = "RPC response missing latest_block_height";
      logger.warn({ latencyMs, data }, errMsg);
      return { height: null, latencyMs, error: errMsg };
    }

    const height = parseInt(rawHeight, 10);
    if (Number.isNaN(height)) {
      const errMsg = `Could not parse block height: "${rawHeight}"`;
      logger.warn({ latencyMs, rawHeight }, errMsg);
      return { height: null, latencyMs, error: errMsg };
    }

    logger.debug({ height, latencyMs }, "RPC height fetched");
    return { height, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const errMsg =
      err instanceof Error ? err.message : "Unknown RPC error";
    logger.error({ err, latencyMs }, "RPC fetch failed");
    return { height: null, latencyMs: 0, error: errMsg };
  }
}
