import { readFileSync, writeFileSync } from "node:fs";
import { logger } from "../utils/logger.js";

type DbState = "ok" | "lagging" | "down";

interface PersistedState {
  dbs: Record<string, DbState>;
  rpcDown: boolean;
}

const STATE_FILE = process.env.ALERT_STATE_FILE ?? "/tmp/alert_state.json";

/**
 * Tracks alert/recovery transitions per database label.
 * Ensures alerts fire only once per transition (not every tick).
 * State is persisted to disk so restarts don't cause alert spam.
 */
export class AlertState {
  private states: Map<string, DbState> = new Map();
  private rpcDown = false;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(STATE_FILE, "utf8");
      const obj = JSON.parse(raw) as PersistedState;
      for (const [label, state] of Object.entries(obj.dbs ?? {})) {
        this.states.set(label, state);
      }
      this.rpcDown = obj.rpcDown ?? false;
      logger.info({ file: STATE_FILE }, "Alert state loaded from disk");
    } catch {
      // File not found on first run — start fresh
    }
  }

  private save(): void {
    try {
      const obj: PersistedState = {
        dbs: Object.fromEntries(this.states),
        rpcDown: this.rpcDown,
      };
      writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2), "utf8");
    } catch (err: unknown) {
      logger.debug({ err }, "Failed to persist alert state");
    }
  }

  /**
   * Returns true only on the FIRST transition to "lagging" or "down".
   * Subsequent ticks with the same state return false (no spam).
   */
  shouldAlert(label: string, newStatus: "lagging" | "down"): boolean {
    const current = this.states.get(label) ?? "ok";
    return current !== newStatus;
  }

  /**
   * Returns true only on the FIRST transition back to "ok" from lagging/down.
   */
  shouldRecover(label: string): boolean {
    const current = this.states.get(label) ?? "ok";
    return current !== "ok";
  }

  markAlerted(label: string, status: "lagging" | "down"): void {
    const prev = this.states.get(label) ?? "ok";
    this.states.set(label, status);
    this.save();
    logger.debug({ label, prev, status }, "AlertState: marked alerted");
  }

  markRecovered(label: string): void {
    const prev = this.states.get(label) ?? "ok";
    this.states.set(label, "ok");
    this.save();
    logger.debug({ label, prev }, "AlertState: marked recovered");
  }

  shouldAlertRpcDown(): boolean {
    return !this.rpcDown;
  }

  markRpcDown(): void {
    this.rpcDown = true;
    this.save();
    logger.debug("AlertState: RPC marked down");
  }

  markRpcUp(): void {
    this.rpcDown = false;
    this.save();
    logger.debug("AlertState: RPC marked up");
  }

  isRpcDown(): boolean {
    return this.rpcDown;
  }
}
