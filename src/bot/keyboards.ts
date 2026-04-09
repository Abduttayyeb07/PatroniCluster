import { InlineKeyboard } from "grammy";

/**
 * Main inline keyboard — 3 rows of buttons.
 */
export function getMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Status", "status")
    .text("🏓 Ping", "ping")
    .text("⏱ Latency", "latency")
    .row()
    .text("💾 Sizes", "sizes")
    .text("🖥 Servers", "servers")
    .text("🩺 Health", "health")
    .row()
    .text("🌐 RPC", "rpc")
    .text("📋 Report", "report")
    .text("♻️ Refresh", "refresh");
}

/**
 * Server sub-menu keyboard — 3 actions + home.
 */
export function getServerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💿 Storage", "srv_total")
    .text("🧠 Memory", "srv_free")
    .row()
    .text("📊 System Load", "srv_latency")
    .text("🏠 Home", "home");
}
