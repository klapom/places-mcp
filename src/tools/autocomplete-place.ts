import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { autocomplete } from "../upstream/places-client.js";
import type { ToolsContext } from "./context.js";

const shape = {
  input: z.string(),
  near_lat: z.number().optional(),
  near_lng: z.number().optional(),
};

export const autocompletePlaceTool: ToolDef<typeof shape, ToolsContext> = {
  name: "autocomplete_place",
  description: "Get place name suggestions for partial input.",
  shape,
  handler: async (ctx, { input, near_lat, near_lng }) => {
    ctx.limiter.check();
    const lat = near_lat ?? (ctx.hasDefaultLocation ? ctx.defaultLat : undefined);
    const lng = near_lng ?? (ctx.hasDefaultLocation ? ctx.defaultLng : undefined);
    const location =
      lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined;
    const suggestions = await autocomplete(ctx.apiKey, input, location);
    const text =
      suggestions.length === 0
        ? "Keine Vorschläge gefunden."
        : JSON.stringify(suggestions, null, 2);
    return { content: [{ type: "text", text }] };
  },
};
