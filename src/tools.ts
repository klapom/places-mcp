/**
 * Shared tool definitions for places-mcp.
 * Used by both stdio (index.ts) and HTTP (http_server.ts) surfaces.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  searchText,
  searchNearby,
  getPlaceDetails,
  autocomplete,
} from "./places-client.js";
import { computeRoute, type TravelMode } from "./tools/routes.js";
import { computeRouteWeather } from "./tools/route-weather.js";
import { RateLimiter } from "./rate-limiter.js";

export type ToolResult = { content: Array<{ type: "text"; text: string }> };

export type ToolsContext = {
  apiKey: string;
  limiter: RateLimiter;
  defaultLat: number;
  defaultLng: number;
  hasDefaultLocation: boolean;
};

type ToolDef<S extends z.ZodRawShape> = {
  name: string;
  description: string;
  shape: S;
  handler: (ctx: ToolsContext, args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>;
};

export function buildToolDefs() {
  const search_places: ToolDef<{
    query: z.ZodString;
    near_lat: z.ZodOptional<z.ZodNumber>;
    near_lng: z.ZodOptional<z.ZodNumber>;
    radius_meters: z.ZodDefault<z.ZodNumber>;
    max_results: z.ZodDefault<z.ZodNumber>;
  }> = {
    name: "search_places",
    description:
      "Search places by text query ('Pizza München', 'Zahnarzt in der Nähe'). Returns name, address, rating, opening status.",
    shape: {
      query: z.string().describe("What to search for"),
      near_lat: z.number().optional(),
      near_lng: z.number().optional(),
      radius_meters: z.number().int().default(5000),
      max_results: z.number().int().min(1).max(20).default(5),
    },
    handler: async (ctx, { query, near_lat, near_lng, radius_meters, max_results }) => {
      ctx.limiter.check();
      const lat = near_lat ?? (ctx.hasDefaultLocation ? ctx.defaultLat : undefined);
      const lng = near_lng ?? (ctx.hasDefaultLocation ? ctx.defaultLng : undefined);
      const location = lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined;
      const places = await searchText(ctx.apiKey, query, location, radius_meters, max_results);
      const text = places.length === 0 ? `Keine Ergebnisse für: "${query}"` : JSON.stringify(places, null, 2);
      return { content: [{ type: "text", text }] };
    },
  };

  const search_nearby: ToolDef<{
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    types: z.ZodDefault<z.ZodArray<z.ZodString>>;
    radius_meters: z.ZodDefault<z.ZodNumber>;
    max_results: z.ZodDefault<z.ZodNumber>;
  }> = {
    name: "search_nearby",
    description: "Find places near specific coordinates. Requires latitude and longitude.",
    shape: {
      latitude: z.number(),
      longitude: z.number(),
      types: z.array(z.string()).default([]),
      radius_meters: z.number().int().min(1).max(50000).default(1000),
      max_results: z.number().int().min(1).max(20).default(5),
    },
    handler: async (ctx, { latitude, longitude, types, radius_meters, max_results }) => {
      ctx.limiter.check();
      const places = await searchNearby(
        ctx.apiKey,
        { latitude, longitude },
        radius_meters,
        types,
        max_results,
      );
      const text = places.length === 0 ? "Keine Orte in der Nähe gefunden." : JSON.stringify(places, null, 2);
      return { content: [{ type: "text", text }] };
    },
  };

  const get_place_details: ToolDef<{ place_id: z.ZodString }> = {
    name: "get_place_details",
    description: "Get full details for a place by ID (from search results).",
    shape: { place_id: z.string() },
    handler: async (ctx, { place_id }) => {
      ctx.limiter.check();
      const details = await getPlaceDetails(ctx.apiKey, place_id);
      return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }] };
    },
  };

  const autocomplete_place: ToolDef<{
    input: z.ZodString;
    near_lat: z.ZodOptional<z.ZodNumber>;
    near_lng: z.ZodOptional<z.ZodNumber>;
  }> = {
    name: "autocomplete_place",
    description: "Get place name suggestions for partial input.",
    shape: {
      input: z.string(),
      near_lat: z.number().optional(),
      near_lng: z.number().optional(),
    },
    handler: async (ctx, { input, near_lat, near_lng }) => {
      ctx.limiter.check();
      const lat = near_lat ?? (ctx.hasDefaultLocation ? ctx.defaultLat : undefined);
      const lng = near_lng ?? (ctx.hasDefaultLocation ? ctx.defaultLng : undefined);
      const location = lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined;
      const suggestions = await autocomplete(ctx.apiKey, input, location);
      const text = suggestions.length === 0 ? "Keine Vorschläge gefunden." : JSON.stringify(suggestions, null, 2);
      return { content: [{ type: "text", text }] };
    },
  };

  const compute_route_tool: ToolDef<{
    origin: z.ZodString;
    destination: z.ZodString;
    mode: z.ZodDefault<z.ZodEnum<["DRIVE", "WALK", "BICYCLE", "TRANSIT"]>>;
  }> = {
    name: "compute_route",
    description: "Calculate a route between two addresses; returns duration, distance, turn-by-turn and a Google Maps link.",
    shape: {
      origin: z.string(),
      destination: z.string(),
      mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("DRIVE"),
    },
    handler: async (ctx, { origin, destination, mode }) => {
      ctx.limiter.check();
      const route = await computeRoute(ctx.apiKey, origin, destination, mode as TravelMode);
      const stepsText = route.steps.length > 0
        ? "\n\nAbbiegungen:\n" + route.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
        : "";
      const text =
        `Route: ${origin} → ${destination}\n` +
        `Dauer: ${route.durationText}\n` +
        `Entfernung: ${route.distanceText}\n` +
        `\nGoogle Maps öffnen:\n${route.mapsLink}` + stepsText;
      return { content: [{ type: "text", text }] };
    },
  };

  const get_route_weather: ToolDef<{
    origin: z.ZodString;
    destination: z.ZodString;
    mode: z.ZodDefault<z.ZodEnum<["DRIVE", "WALK", "BICYCLE", "TRANSIT"]>>;
    departure_time: z.ZodOptional<z.ZodString>;
    interval_minutes: z.ZodDefault<z.ZodNumber>;
  }> = {
    name: "get_route_weather",
    description: "Show weather conditions along a driving route, sampled every 30 minutes.",
    shape: {
      origin: z.string(),
      destination: z.string(),
      mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("DRIVE"),
      departure_time: z.string().optional(),
      interval_minutes: z.number().int().min(15).max(60).default(30),
    },
    handler: async (ctx, { origin, destination, mode, departure_time, interval_minutes }) => {
      ctx.limiter.check();
      const departure = departure_time ? new Date(departure_time) : new Date();
      const text = await computeRouteWeather(
        ctx.apiKey,
        origin,
        destination,
        mode as TravelMode,
        departure,
        interval_minutes,
      );
      return { content: [{ type: "text", text }] };
    },
  };

  const usage_status: ToolDef<Record<string, never>> = {
    name: "usage_status",
    description: "Show current API usage and remaining quota for this hour and month.",
    shape: {},
    handler: async (ctx) => {
      const s = ctx.limiter.status();
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
  };

  return [
    search_places,
    search_nearby,
    get_place_details,
    autocomplete_place,
    compute_route_tool,
    get_route_weather,
    usage_status,
  ] as const;
}

/**
 * Register all tools on an McpServer instance.
 */
export function registerTools(server: McpServer, ctx: ToolsContext): void {
  for (const def of buildToolDefs()) {
    server.tool(
      def.name,
      def.description,
      def.shape,
      ((args: unknown) => (def.handler as (c: ToolsContext, a: unknown) => Promise<ToolResult>)(ctx, args)),
    );
  }
}

/**
 * Build a name→caller map for the REST surface.
 */
export function buildRestHandlers(ctx: ToolsContext) {
  const handlers: Record<string, (args: unknown) => Promise<ToolResult>> = {};
  const names: string[] = [];
  for (const def of buildToolDefs()) {
    names.push(def.name);
    handlers[def.name] = async (args) => {
      const parsed = z.object(def.shape).parse(args ?? {});
      return (def.handler as (c: ToolsContext, a: unknown) => Promise<ToolResult>)(ctx, parsed);
    };
  }
  return { handlers, names };
}
