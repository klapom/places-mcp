import pino from "pino";
import { RateLimiter } from "../rate-limiter.js";
import type { ToolsContext } from "./context.js";

/**
 * Build a ToolsContext with silent logger + in-memory rate-limiter
 * pointing at an ephemeral file under /tmp. Overrides merge in last.
 */
export function buildTestContext(overrides: Partial<ToolsContext> = {}): ToolsContext {
  const logger = pino({ level: "silent" });
  const limiter = new RateLimiter({
    maxPerHour: 1000,
    maxPerMonth: 100000,
    usageFile: `/tmp/places-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  });
  return {
    logger,
    apiKey: "TEST_KEY",
    limiter,
    defaultLat: 48.1351,
    defaultLng: 11.582,
    hasDefaultLocation: false,
    ...overrides,
  };
}
