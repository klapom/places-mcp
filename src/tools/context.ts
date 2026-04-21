import type { ToolsContext as BaseContext } from "@klapom/mcp-toolkit-ts";
import type { Logger } from "pino";
import { RateLimiter, loadRateLimitConfig } from "../rate-limiter.js";

/**
 * Dependencies + defaults shared across places tools.
 *
 * Extends toolkit's ToolsContext with Google-API key, rate-limiter and
 * optional default location bias.
 */
export type ToolsContext = BaseContext & {
  apiKey: string;
  limiter: RateLimiter;
  defaultLat: number;
  defaultLng: number;
  hasDefaultLocation: boolean;
};

function loadApiKey(logger: Logger): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    logger.fatal("missing GOOGLE_PLACES_API_KEY in .env");
    process.exit(1);
  }
  return key;
}

export function loadContext(logger: Logger): ToolsContext {
  const apiKey = loadApiKey(logger);
  const limiter = new RateLimiter(loadRateLimitConfig());
  const defaultLat = Number(process.env.DEFAULT_LAT ?? Number.NaN);
  const defaultLng = Number(process.env.DEFAULT_LNG ?? Number.NaN);
  const hasDefaultLocation = Number.isFinite(defaultLat) && Number.isFinite(defaultLng);
  return { logger, apiKey, limiter, defaultLat, defaultLng, hasDefaultLocation };
}
