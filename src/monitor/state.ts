import { logger } from "../utils/logger.js";

type DbState = "ok" | "lagging" | "down";

/**
 * Tracks alert/recovery transitions per database label.
 * Ensures alerts fire only once per transition (not every tick).
 */
export class AlertState {
  private states: Map<string, DbState> = new Map();
  private rpcDown = false;

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

  /**
   * Mark a DB as alerted (lagging or down).
   */
  markAlerted(label: string, status: "lagging" | "down"): void {
    const prev = this.states.get(label) ?? "ok";
    this.states.set(label, status);
    logger.debug({ label, prev, status }, "AlertState: marked alerted");
  }

  /**
   * Mark a DB as recovered (back to ok).
   */
  markRecovered(label: string): void {
    const prev = this.states.get(label) ?? "ok";
    this.states.set(label, "ok");
    logger.debug({ label, prev }, "AlertState: marked recovered");
  }

  /**
   * Track RPC down state. Returns true only on first transition to down.
   */
  shouldAlertRpcDown(): boolean {
    if (!this.rpcDown) {
      return true;
    }
    return false;
  }

  markRpcDown(): void {
    this.rpcDown = true;
    logger.debug("AlertState: RPC marked down");
  }

  markRpcUp(): void {
    this.rpcDown = false;
    logger.debug("AlertState: RPC marked up");
  }

  isRpcDown(): boolean {
    return this.rpcDown;
  }
}
