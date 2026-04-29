# ZigChain Indexer Sync Monitor Bot

Production-ready Telegram bot that monitors 5 blockchain indexer databases (3 PostgreSQL + 2 ClickHouse) against the live ZigChain RPC endpoint. Fires alerts when any DB falls behind, sends recovery notifications when sync is restored, and provides interactive inline keyboard controls for on-demand status checks.

## Architecture

```
┌─────────────────────────────────────────────┐
│              ZigChain RPC                    │
│   https://zigchain-mainnet.zigscan.net       │
└──────────────────┬──────────────────────────┘
                   │  GET /status
                   ▼
┌─────────────────────────────────────────────┐
│           Heartbeat Loop (5 min)             │
│                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │  PG-01  │ │  PG-02  │ │  PG-03  │       │
│  └────┬────┘ └────┬────┘ └────┬────┘       │
│       │           │           │              │
│  ┌────┴────┐ ┌────┴────┐                    │
│  │  CH-01  │ │  CH-02  │                    │
│  └─────────┘ └─────────┘                    │
│                                              │
│  Gap = RPC Height − DB Height                │
│  🟢 < 100  │  🟡 100–500  │  🔴 > 500       │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│          Telegram Alerts + Bot               │
│                                              │
│  ⚠️  Lag alerts (gap > 500 blocks)           │
│  🔴  Down alerts (connection failed)         │
│  ✅  Recovery alerts (gap < 100 blocks)      │
│  📊  On-demand status via inline keyboard    │
└─────────────────────────────────────────────┘
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your actual values:
#   - TELEGRAM_BOT_TOKEN from @BotFather
#   - ALLOWED_USER_IDS (your Telegram user ID)
#   - ALERT_CHAT_IDS (chat IDs for automatic alerts)
#   - Database connection strings
```

### 3. Run in development

```bash
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot-reload via tsx |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm run lint` | Type-check without emitting |

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with inline keyboard |
| `/status` | Current sync status of all databases |

## Inline Keyboard

| Button | Action |
|--------|--------|
| 📊 Global Status | Full status table of all 5 DBs |
| 💾 DB Sizes | Database sizes in human-readable format |
| 🌐 RPC Info | RPC endpoint height and latency |
| ♻️ Refresh | Refresh the current status view |

## Alert Behavior

- **Lag Alert**: Fires once when a DB falls > `ALERT_GAP_THRESHOLD` (500) blocks behind RPC
- **Down Alert**: Fires once when a DB connection fails
- **Recovery Alert**: Fires once when a DB returns to < `RECOVERY_GAP_THRESHOLD` (100) blocks behind
- **RPC Down Alert**: Fires once when the RPC endpoint becomes unreachable
- Alerts are **transition-based** — they fire only on state change, never spam

## Production Deployment

### Build

```bash
npm run build
```

### Systemd (Linux)

```bash
# Copy files to /opt/zigchain-bot
sudo cp -r dist/ package.json node_modules/ .env /opt/zigchain-bot/

# Install service
sudo cp zigchain-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable zigchain-monitor
sudo systemctl start zigchain-monitor

# Check logs
sudo journalctl -u zigchain-monitor -f
```

## Project Structure

```
zigchain-bot/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Zod-validated env config
│   ├── rpc.ts                # ZigChain RPC client
│   ├── db/
│   │   ├── postgres.ts       # PostgreSQL height/size queries
│   │   └── clickhouse.ts     # ClickHouse height/size queries
│   ├── monitor/
│   │   ├── heartbeat.ts      # Background check loop (5 min)
│   │   ├── state.ts          # Alert state transitions
│   │   └── checker.ts        # Concurrent status collection
│   ├── bot/
│   │   ├── bot.ts            # Grammy bot + auth middleware
│   │   ├── keyboards.ts      # Inline keyboard layouts
│   │   ├── handlers.ts       # /start, /status commands
│   │   └── callbacks.ts      # Button callback handlers
│   └── utils/
│       ├── format.ts         # MarkdownV2 message formatters
│       └── logger.ts         # Pino logger (console + file)
├── .env.example
├── package.json
├── tsconfig.json
├── zigchain-monitor.service  # systemd unit
└── README.md
```

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript 5+ (strict mode)
- **Telegram**: grammy
- **PostgreSQL**: postgres (sql tag client)
- **ClickHouse**: @clickhouse/client
- **Config**: dotenv + zod
- **Logging**: pino + pino-pretty
- **Build**: tsx (dev) / tsc (production)
