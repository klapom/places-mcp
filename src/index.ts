import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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

function loadApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    process.stderr.write("[places-mcp] Missing GOOGLE_PLACES_API_KEY in .env\n");
    process.exit(1);
  }
  return key;
}

const server = new McpServer({ name: "places-mcp", version: VERSION });

async function main() {
  const apiKey = loadApiKey();
  const limiterConfig = loadRateLimitConfig();
  const limiter = new RateLimiter(limiterConfig);

  const defaultLat = parseFloat(process.env.DEFAULT_LAT ?? "0");
  const defaultLng = parseFloat(process.env.DEFAULT_LNG ?? "0");
  const hasDefaultLocation = defaultLat !== 0 && defaultLng !== 0;

  process.stderr.write(
    `[places-mcp] v${VERSION} started. Limits: ${limiterConfig.maxPerHour}/h, ${limiterConfig.maxPerMonth}/month\n`,
  );

  server.tool(
    "search_places",
    "Search for places by text query (e.g. 'Pizza Restaurant München', 'Zahnarzt in der Nähe'). Returns name, address, rating, opening status.",
    {
      query: z.string().describe("What to search for"),
      near_lat: z.number().optional().describe("Latitude to bias results towards"),
      near_lng: z.number().optional().describe("Longitude to bias results towards"),
      radius_meters: z.number().int().default(5000).describe("Search radius in meters"),
      max_results: z.number().int().min(1).max(20).default(5).describe("Max results"),
    },
    async ({ query, near_lat, near_lng, radius_meters, max_results }) => {
      limiter.check();

      const lat = near_lat ?? (hasDefaultLocation ? defaultLat : undefined);
      const lng = near_lng ?? (hasDefaultLocation ? defaultLng : undefined);
      const location =
        lat !== undefined && lng !== undefined
          ? { latitude: lat, longitude: lng }
          : undefined;

      const places = await searchText(apiKey, query, location, radius_meters, max_results);

      if (places.length === 0) {
        return { content: [{ type: "text", text: `Keine Ergebnisse für: "${query}"` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(places, null, 2) }] };
    },
  );

  server.tool(
    "search_nearby",
    "Find places near specific coordinates. Requires latitude and longitude.",
    {
      latitude: z.number().describe("Latitude of center point"),
      longitude: z.number().describe("Longitude of center point"),
      types: z
        .array(z.string())
        .default([])
        .describe("Google place types, e.g. ['restaurant'], ['pharmacy'], ['atm']"),
      radius_meters: z.number().int().min(1).max(50000).default(1000),
      max_results: z.number().int().min(1).max(20).default(5),
    },
    async ({ latitude, longitude, types, radius_meters, max_results }) => {
      limiter.check();
      const places = await searchNearby(
        apiKey,
        { latitude, longitude },
        radius_meters,
        types,
        max_results,
      );
      if (places.length === 0) {
        return { content: [{ type: "text", text: "Keine Orte in der Nähe gefunden." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(places, null, 2) }] };
    },
  );

  server.tool(
    "get_place_details",
    "Get full details for a place by ID (from search results). Returns opening hours, phone, website, amenities.",
    {
      place_id: z.string().describe("Google Place ID from search results"),
    },
    async ({ place_id }) => {
      limiter.check();
      const details = await getPlaceDetails(apiKey, place_id);
      return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }] };
    },
  );

  server.tool(
    "autocomplete_place",
    "Get place name suggestions for partial input.",
    {
      input: z.string().describe("Partial place name or address"),
      near_lat: z.number().optional(),
      near_lng: z.number().optional(),
    },
    async ({ input, near_lat, near_lng }) => {
      limiter.check();
      const lat = near_lat ?? (hasDefaultLocation ? defaultLat : undefined);
      const lng = near_lng ?? (hasDefaultLocation ? defaultLng : undefined);
      const location =
        lat !== undefined && lng !== undefined
          ? { latitude: lat, longitude: lng }
          : undefined;

      const suggestions = await autocomplete(apiKey, input, location);
      if (suggestions.length === 0) {
        return { content: [{ type: "text", text: "Keine Vorschläge gefunden." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }] };
    },
  );

  server.tool(
    "compute_route",
    "Calculate a route between two addresses and return duration, distance, turn-by-turn steps, and a Google Maps link to open navigation on the phone.",
    {
      origin: z
        .string()
        .describe("Start address, e.g. 'Marienplatz München' or 'Meine aktuelle Position' (use current location)"),
      destination: z
        .string()
        .describe("Destination address, e.g. 'Flughafen München', 'BMW Welt München'"),
      mode: z
        .enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"])
        .default("DRIVE")
        .describe("Travel mode: DRIVE (Auto), WALK (zu Fuß), BICYCLE (Fahrrad), TRANSIT (ÖPNV)"),
    },
    async ({ origin, destination, mode }) => {
      limiter.check();
      const route = await computeRoute(apiKey, origin, destination, mode as TravelMode);

      const stepsText =
        route.steps.length > 0
          ? "\n\nAbbiegungen:\n" + route.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
          : "";

      const text =
        `Route: ${origin} → ${destination}\n` +
        `Dauer: ${route.durationText}\n` +
        `Entfernung: ${route.distanceText}\n` +
        `\nGoogle Maps öffnen:\n${route.mapsLink}` +
        stepsText;

      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "get_route_weather",
    "Show weather conditions along a driving route, sampled every 30 minutes. Perfect for long trips — shows temperature, rain chance and wind at each point along the way.",
    {
      origin: z.string().describe("Start address, e.g. 'München Hauptbahnhof'"),
      destination: z.string().describe("Destination address, e.g. 'Hamburg Hauptbahnhof'"),
      mode: z
        .enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"])
        .default("DRIVE")
        .describe("Travel mode"),
      departure_time: z
        .string()
        .optional()
        .describe(
          'Departure time as ISO string, e.g. "2026-02-20T08:00:00". Default: now.',
        ),
      interval_minutes: z
        .number()
        .int()
        .min(15)
        .max(60)
        .default(30)
        .describe("Weather sample interval in minutes (15–60). Default: 30."),
    },
    async ({ origin, destination, mode, departure_time, interval_minutes }) => {
      limiter.check();
      const departure = departure_time
        ? new Date(departure_time)
        : new Date();

      const result = await computeRouteWeather(
        apiKey,
        origin,
        destination,
        mode as TravelMode,
        departure,
        interval_minutes,
      );
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "usage_status",
    "Show current API usage and remaining quota for this hour and month.",
    {},
    async () => {
      const s = limiter.status();
      const hourRemaining = s.hourLimit - s.hourUsed;
      const monthRemaining = s.monthLimit - s.monthUsed;
      const monthPct = ((s.monthUsed / s.monthLimit) * 100).toFixed(1);

      const text =
        `Places API Nutzung:\n` +
        `  Diese Stunde:  ${s.hourUsed} / ${s.hourLimit} (${hourRemaining} verbleibend)\n` +
        `  Dieser Monat:  ${s.monthUsed} / ${s.monthLimit} (${monthPct}% verbraucht, ${monthRemaining} verbleibend)\n` +
        `  Monat:         ${s.monthKey}`;

      return { content: [{ type: "text", text }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (signal: string) => {
    process.stderr.write(`[places-mcp] Shutting down (${signal})...\n`);
    await server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  process.stderr.write(
    `[places-mcp] Fatal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
