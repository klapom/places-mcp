import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { searchText } from "../upstream/places-client.js";
import type { ToolsContext } from "./context.js";

const shape = {
  query: z.string().describe("What to search for"),
  near_lat: z.number().optional(),
  near_lng: z.number().optional(),
  radius_meters: z.number().int().default(5000),
  max_results: z.number().int().min(1).max(20).default(5),
};

export const searchPlacesTool: ToolDef<typeof shape, ToolsContext> = {
  name: "search_places",
  description:
    "Search places by text query ('Pizza München', 'Zahnarzt in der Nähe'). Returns name, address, rating, opening status.",
  shape,
  handler: async (ctx, { query, near_lat, near_lng, radius_meters, max_results }) => {
    ctx.limiter.check();
    const lat = near_lat ?? (ctx.hasDefaultLocation ? ctx.defaultLat : undefined);
    const lng = near_lng ?? (ctx.hasDefaultLocation ? ctx.defaultLng : undefined);
    const location =
      lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined;
    const places = await searchText(ctx.apiKey, query, location, radius_meters, max_results);
    const text =
      places.length === 0 ? `Keine Ergebnisse für: "${query}"` : JSON.stringify(places, null, 2);
    return { content: [{ type: "text", text }] };
  },
};
