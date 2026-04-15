/**
 * Combined HTTP server for places-mcp:
 *   - REST on LISTEN_PORT (default 32610)
 *   - MCP Streamable-HTTP on MCP_PORT (default 33610, /mcp)
 *
 * Env:
 *   LISTEN_PORT / MCP_PORT      ports
 *   LISTEN_HOST                 default 0.0.0.0 (legacy HTTP_HOST honored)
 *   GOOGLE_PLACES_API_KEY       required
 *   DEFAULT_LAT / DEFAULT_LNG   optional location bias
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RateLimiter, loadRateLimitConfig } from "./rate-limiter.js";
import { registerTools, buildRestHandlers, type ToolsContext } from "./tools.js";

const VERSION = "0.2.0";
const REST_PORT = Number(process.env.LISTEN_PORT ?? process.env.HTTP_PORT ?? 32610);
const MCP_PORT = Number(process.env.MCP_PORT ?? 33610);
const HOST = process.env.LISTEN_HOST ?? process.env.HTTP_HOST ?? "0.0.0.0";

function loadApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    process.stderr.write("[places-mcp-http] Missing GOOGLE_PLACES_API_KEY\n");
    process.exit(1);
  }
  return key;
}

const ctx: ToolsContext = {
  apiKey: loadApiKey(),
  limiter: new RateLimiter(loadRateLimitConfig()),
  defaultLat: parseFloat(process.env.DEFAULT_LAT ?? "0"),
  defaultLng: parseFloat(process.env.DEFAULT_LNG ?? "0"),
  hasDefaultLocation:
    parseFloat(process.env.DEFAULT_LAT ?? "0") !== 0 &&
    parseFloat(process.env.DEFAULT_LNG ?? "0") !== 0,
};

const { handlers, names: toolNames } = buildRestHandlers(ctx);

// ---------------------- REST ----------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const restServer = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const rawUrl = req.url ?? "/";
  const url = rawUrl.split("?")[0];
  try {
    if (method === "GET" && (url === "/" || url === "/health")) {
      sendJson(res, 200, {
        service: "places-mcp-http",
        version: VERSION,
        tools: toolNames,
        mcpEndpoint: `http://${HOST}:${MCP_PORT}/mcp`,
      });
      return;
    }
    if (method === "GET" && url === "/tools") {
      sendJson(res, 200, { tools: toolNames });
      return;
    }
    if (method === "POST" && url.startsWith("/tools/")) {
      const name = url.slice("/tools/".length).split("?")[0];
      const handler = handlers[name];
      if (!handler) {
        sendJson(res, 404, { ok: false, error: `Unknown tool: ${name}` });
        return;
      }
      const raw = await readBody(req);
      let args: Record<string, unknown> = {};
      if (raw.trim().length > 0) {
        try {
          args = JSON.parse(raw);
          if (typeof args !== "object" || args === null || Array.isArray(args)) {
            throw new Error("Body must be a JSON object");
          }
        } catch (e) {
          sendJson(res, 400, {
            ok: false,
            error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}`,
          });
          return;
        }
      }
      const result = await handler(args);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    sendJson(res, 404, { ok: false, error: "Not found", method, url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[places-mcp-http] REST error ${method} ${url}: ${msg}\n`);
    sendJson(res, 500, { ok: false, error: msg });
  }
});

// ---------------------- MCP Streamable-HTTP ----------------------

function buildMcpServer(): McpServer {
  const s = new McpServer({ name: "places-mcp", version: VERSION });
  registerTools(s, ctx);
  return s;
}

const mcpSessions = new Map<string, StreamableHTTPServerTransport>();

const mcpHttpServer = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const path = url.split("?")[0];
  if (path !== "/mcp" && path !== "/") {
    sendJson(res, 404, { ok: false, error: "Not found. Use /mcp for MCP Streamable-HTTP." });
    return;
  }
  try {
    const sid = (req.headers["mcp-session-id"] ?? req.headers["x-mcp-session-id"]) as string | undefined;
    let transport = sid ? mcpSessions.get(sid) : undefined;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSid) => {
          mcpSessions.set(newSid, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) mcpSessions.delete(transport!.sessionId);
      };
      const srv = buildMcpServer();
      await srv.connect(transport);
    }
    await transport.handleRequest(req, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[places-mcp-http] MCP error: ${msg}\n`);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: msg });
  }
});

async function start() {
  restServer.listen(REST_PORT, HOST, () => {
    process.stderr.write(`[places-mcp-http] REST v${VERSION} on ${HOST}:${REST_PORT}\n`);
  });
  mcpHttpServer.listen(MCP_PORT, HOST, () => {
    process.stderr.write(`[places-mcp-http] MCP  v${VERSION} on ${HOST}:${MCP_PORT}/mcp\n`);
  });
}
start().catch((err) => {
  process.stderr.write(`[places-mcp-http] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

const shutdown = (signal: string) => {
  process.stderr.write(`[places-mcp-http] Shutting down (${signal})...\n`);
  restServer.close();
  mcpHttpServer.close();
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
