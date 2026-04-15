import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  searchText,
  searchNearby,
  getPlaceDetails,
  autocomplete,
} from "./places-client.js";
import { computeRoute, type TravelMode } from "./tools/routes.js";
import { computeRouteWeather } from "./tools/route-weather.js";
import { RateLimiter, loadRateLimitConfig } from "./rate-limiter.js";

const VERSION = "0.1.0";
const PORT = parseInt(process.env.HTTP_PORT ?? "8203", 10);
const HOST = process.env.HTTP_HOST ?? "0.0.0.0";

function loadApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    process.stderr.write("[places-mcp-http] Missing GOOGLE_PLACES_API_KEY\n");
    process.exit(1);
  }
  return key;
}

const apiKey = loadApiKey();
const limiter = new RateLimiter(loadRateLimitConfig());

const defaultLat = parseFloat(process.env.DEFAULT_LAT ?? "0");
const defaultLng = parseFloat(process.env.DEFAULT_LNG ?? "0");
const hasDefaultLocation = defaultLat !== 0 && defaultLng !== 0;

type Handler = (body: any) => Promise<any>;

const tools: Record<string, Handler> = {
  search_places: async (b) => {
    limiter.check();
    const query = String(b.query ?? "");
    if (!query) throw new Error("query required");
    const lat = b.near_lat ?? (hasDefaultLocation ? defaultLat : undefined);
    const lng = b.near_lng ?? (hasDefaultLocation ? defaultLng : undefined);
    const location =
      lat !== undefined && lng !== undefined
        ? { latitude: lat, longitude: lng }
        : undefined;
    const radius = b.radius_meters ?? 5000;
    const max = b.max_results ?? 5;
    return await searchText(apiKey, query, location, radius, max);
  },

  search_nearby: async (b) => {
    limiter.check();
    if (typeof b.latitude !== "number" || typeof b.longitude !== "number") {
      throw new Error("latitude and longitude required");
    }
    const types = Array.isArray(b.types) ? b.types : [];
    const radius = b.radius_meters ?? 1000;
    const max = b.max_results ?? 5;
    return await searchNearby(
      apiKey,
      { latitude: b.latitude, longitude: b.longitude },
      radius,
      types,
      max,
    );
  },

  get_place_details: async (b) => {
    limiter.check();
    if (!b.place_id) throw new Error("place_id required");
    return await getPlaceDetails(apiKey, String(b.place_id));
  },

  autocomplete_place: async (b) => {
    limiter.check();
    const input = String(b.input ?? "");
    if (!input) throw new Error("input required");
    const lat = b.near_lat ?? (hasDefaultLocation ? defaultLat : undefined);
    const lng = b.near_lng ?? (hasDefaultLocation ? defaultLng : undefined);
    const location =
      lat !== undefined && lng !== undefined
        ? { latitude: lat, longitude: lng }
        : undefined;
    return await autocomplete(apiKey, input, location);
  },

  compute_route: async (b) => {
    limiter.check();
    if (!b.origin || !b.destination) throw new Error("origin and destination required");
    const mode = (b.mode ?? "DRIVE") as TravelMode;
    return await computeRoute(apiKey, String(b.origin), String(b.destination), mode);
  },

  get_route_weather: async (b) => {
    limiter.check();
    if (!b.origin || !b.destination) throw new Error("origin and destination required");
    const mode = (b.mode ?? "DRIVE") as TravelMode;
    const departure = b.departure_time ? new Date(b.departure_time) : new Date();
    const interval = b.interval_minutes ?? 30;
    const text = await computeRouteWeather(
      apiKey,
      String(b.origin),
      String(b.destination),
      mode,
      departure,
      interval,
    );
    return { text };
  },

  usage_status: async () => {
    const s = limiter.status();
    return {
      ...s,
      hourRemaining: s.hourLimit - s.hourUsed,
      monthRemaining: s.monthLimit - s.monthUsed,
    };
  },
};

function sendJson(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  if (method === "GET" && url === "/health") {
    return sendJson(res, 200, { ok: true, service: "places-mcp-http", version: VERSION });
  }

  if (method === "GET" && url === "/tools") {
    return sendJson(res, 200, { tools: Object.keys(tools) });
  }

  if (method === "POST" && url.startsWith("/tools/")) {
    const name = url.slice("/tools/".length).split("?")[0];
    const handler = tools[name];
    if (!handler) return sendJson(res, 404, { error: `unknown tool: ${name}` });
    try {
      const body = await readBody(req);
      const result = await handler(body);
      return sendJson(res, 200, { ok: true, result });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: e?.message ?? String(e) });
    }
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  process.stderr.write(
    `[places-mcp-http] v${VERSION} listening on http://${HOST}:${PORT}\n`,
  );
});

const shutdown = (sig: string) => {
  process.stderr.write(`[places-mcp-http] shutdown (${sig})\n`);
  server.close(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
