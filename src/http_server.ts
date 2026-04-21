#!/usr/bin/env node
/**
 * Dual-surface HTTP entry for places-mcp:
 *   - REST on LISTEN_PORT (default 32610)
 *   - MCP Streamable-HTTP on MCP_PORT (default 33610, path /mcp)
 *
 * For stdio MCP (Claude Desktop), see ./index.ts.
 *
 * Env (see .env.example and ADR-010):
 *   LISTEN_PORT / MCP_PORT       ports (32610 / 33610 per PORT_REGISTRY)
 *   LISTEN_HOST                  bind address (default 0.0.0.0)
 *   GOOGLE_PLACES_API_KEY        Google Places (New) API key (required)
 *   DEFAULT_LAT / DEFAULT_LNG    optional location bias
 *   MAX_REQUESTS_PER_HOUR        rate-limiter hourly cap (default 60)
 *   MAX_REQUESTS_PER_MONTH       rate-limiter monthly cap (default 5000)
 *   USAGE_FILE                   persistence path (default ~/.places-mcp/usage.json)
 *   LOG_LEVEL                    pino level (default info)
 */
import { createDualServer, createLogger } from "@klapom/mcp-toolkit-ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import { loadContext } from "./tools/context.js";
import { buildRestHandlers, registerTools } from "./tools/index.js";

const REST_PORT = Number(process.env.LISTEN_PORT ?? 32610);
const MCP_PORT = Number(process.env.MCP_PORT ?? 33610);
const HOST = process.env.LISTEN_HOST ?? "0.0.0.0";

const logger = createLogger(pkg.name);
const ctx = loadContext(logger);

const { handlers, names } = buildRestHandlers(ctx);

const buildMcpServer = (): McpServer => {
  const s = new McpServer({ name: pkg.name, version: pkg.version });
  registerTools(s, ctx);
  return s;
};

const server = createDualServer({
  name: pkg.name,
  version: pkg.version,
  host: HOST,
  restPort: REST_PORT,
  mcpPort: MCP_PORT,
  toolNames: names,
  restHandlers: handlers,
  buildMcpServer,
  logger,
});

logger.info(
  {
    hasDefaultLocation: ctx.hasDefaultLocation,
    defaultLat: ctx.hasDefaultLocation ? ctx.defaultLat : undefined,
    defaultLng: ctx.hasDefaultLocation ? ctx.defaultLng : undefined,
  },
  "context loaded",
);

server.start().catch((err: unknown) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "received shutdown signal");
  await server.stop();
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
