import pino from "pino";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.resolve(__dirname, "../../logs");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const isProduction = process.env["NODE_ENV"] === "production";

const transport = isProduction
  ? pino.transport({
      targets: [
        // Human-readable stdout for Docker logs
        {
          target: "pino-pretty",
          options: {
            colorize: false,
            translateTime: "UTC:yyyy-mm-dd HH:MM:ss",
            ignore: "pid,hostname,name",
            messageFormat: "[{label}] {msg}",
            singleLine: false,
          },
          level: "info",
        },
        // JSON file for structured log storage
        {
          target: "pino/file",
          options: { destination: path.join(logsDir, "bot.log"), mkdir: true },
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
