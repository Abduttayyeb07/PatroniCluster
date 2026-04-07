import pino from "pino";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.resolve(__dirname, "../../logs");

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const isProduction = process.env["NODE_ENV"] === "production";

const transport = isProduction
  ? pino.transport({
      targets: [
        {
          target: "pino/file",
          options: { destination: path.join(logsDir, "bot.log"), mkdir: true },
          level: "info",
        },
        {
          target: "pino/file",
          options: { destination: 1 }, // stdout
          level: "info",
        },
      ],
    })
  : pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    });

export const logger = pino(
  {
    level: isProduction ? "info" : "debug",
    name: "zigchain-bot",
  },
  transport,
);
