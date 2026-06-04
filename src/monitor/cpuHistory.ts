import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../config.js";
import { collectServerInfo } from "./checker.js";
import { logger } from "../utils/logger.js";
import type { ServerStats } from "../utils/ssh.js";

const CPU_HISTORY_FILE = process.env.CPU_HISTORY_FILE ?? "/tmp/cpu_history.json";
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type CpuWindowHours = 6 | 12 | 24;

export interface CpuSample {
  timestamp: string;
  usagePct: number;
}

export interface CpuAverages {
  current: number | null;
  samples: number;
  averages: Record<CpuWindowHours, number | null>;
  aboveThreshold: Record<CpuWindowHours, boolean | null>;
}

type CpuHistoryFile = Record<string, CpuSample[]>;

let loaded = false;
let history: CpuHistoryFile = {};

function loadHistory(): void {
  if (loaded) return;
  loaded = true;

  try {
    const raw = readFileSync(CPU_HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as CpuHistoryFile;
    history = parsed && typeof parsed === "object" ? parsed : {};
    pruneHistory();
    logger.info({ file: CPU_HISTORY_FILE }, "CPU history loaded");
  } catch {
    history = {};
  }
}

function saveHistory(): void {
  try {
    writeFileSync(CPU_HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
  } catch (err: unknown) {
    logger.debug({ err }, "Failed to persist CPU history");
  }
}

function parseCpuPct(value: string): number | null {
  const parsed = Number(value.replace("%", "").trim());
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

function pruneHistory(nowMs = Date.now()): void {
  const cutoff = nowMs - RETENTION_MS;

  for (const [host, samples] of Object.entries(history)) {
    const kept = samples.filter((sample) => {
      const time = Date.parse(sample.timestamp);
      return Number.isFinite(time) && time >= cutoff;
    });

    if (kept.length > 0) {
      history[host] = kept;
    } else {
      delete history[host];
    }
  }
}

export function recordCpuSamples(stats: Map<string, ServerStats>): void {
  loadHistory();

  const timestamp = new Date().toISOString();
  for (const [host, server] of stats) {
    const usagePct = parseCpuPct(server.cpuUsagePct);
    if (usagePct === null) continue;

    history[host] = [...(history[host] ?? []), { timestamp, usagePct }];
  }

  pruneHistory();
  saveHistory();
  logger.debug({ hosts: stats.size }, "CPU history sampled");
}

function averageForWindow(samples: CpuSample[], hours: CpuWindowHours): number | null {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const windowSamples = samples.filter((sample) => {
    const time = Date.parse(sample.timestamp);
    return Number.isFinite(time) && time >= cutoff;
  });

  if (windowSamples.length === 0) return null;

  const sum = windowSamples.reduce((total, sample) => total + sample.usagePct, 0);
  return Math.round((sum / windowSamples.length) * 10) / 10;
}

export function getCpuAverages(host: string): CpuAverages {
  loadHistory();
  pruneHistory();

  const samples = history[host] ?? [];
  const current = samples.at(-1)?.usagePct ?? null;
  const averages = {
    6: averageForWindow(samples, 6),
    12: averageForWindow(samples, 12),
    24: averageForWindow(samples, 24),
  };

  return {
    current,
    samples: samples.length,
    averages,
    aboveThreshold: {
      6: averages[6] === null ? null : averages[6] > config.CPU_AVG_THRESHOLD,
      12: averages[12] === null ? null : averages[12] > config.CPU_AVG_THRESHOLD,
      24: averages[24] === null ? null : averages[24] > config.CPU_AVG_THRESHOLD,
    },
  };
}

export function startCpuHistorySampler(): void {
  const intervalMs = config.CPU_HISTORY_INTERVAL_MS;

  const sample = async (): Promise<void> => {
    try {
      const stats = await collectServerInfo();
      if (stats.size > 0) {
        recordCpuSamples(stats);
      }
    } catch (err: unknown) {
      logger.debug({ err }, "CPU history sample skipped");
    }
  };

  void sample();
  setInterval(() => void sample(), intervalMs);

  logger.info(
    { intervalMs, threshold: config.CPU_AVG_THRESHOLD, file: CPU_HISTORY_FILE },
    "CPU history sampler started",
  );
}
