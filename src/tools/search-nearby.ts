import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { searchNearby } from "../upstream/places-client.js";
import type { ToolsContext } from "./context.js";

const shape = {
  latitude: z.number(),
  longitude: z.number(),
  types: z.array(z.string()).default([]),
  radius_meters: z.number().int().min(1).max(50000).default(1000),
  max_results: z.number().int().min(1).max(20).default(5),
};

export const searchNearbyTool: ToolDef<typeof shape, ToolsContext> = {
  name: "search_nearby",
  description: "Find places near specific coordinates. Requires latitude and longitude.",
  shape,
  handler: async (ctx, { latitude, longitude, types, radius_meters, max_results }) => {
    ctx.limiter.check();
    const places = await searchNearby(
      ctx.apiKey,
      { latitude, longitude },
      radius_meters,
      types,
      max_results,
    );
    const text =
      places.length === 0 ? "Keine Orte in der Nähe gefunden." : JSON.stringify(places, null, 2);
    return { content: [{ type: "text", text }] };
  },
};
