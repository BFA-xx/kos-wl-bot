import pino from "pino";
import { config } from "./config.js";

const isDev = config.NODE_ENV !== "production";

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: "kos-wl-bot" },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname,service",
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;
