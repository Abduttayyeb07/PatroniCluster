import { InlineKeyboard } from "grammy";

/**
 * Main inline keyboard with 4 buttons in a 2×2 grid.
 * Reused across all bot replies so users always have controls.
 */
export function getMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Global Status", "status")
    .text("💾 DB Sizes", "sizes")
    .row()
    .text("🌐 RPC Info", "rpc")
    .text("♻️ Refresh", "refresh");
}
