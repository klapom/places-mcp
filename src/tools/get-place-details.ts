import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { getPlaceDetails } from "../upstream/places-client.js";
import type { ToolsContext } from "./context.js";

const shape = {
  place_id: z.string(),
};

export const getPlaceDetailsTool: ToolDef<typeof shape, ToolsContext> = {
  name: "get_place_details",
  description: "Get full details for a place by ID (from search results).",
  shape,
  handler: async (ctx, { place_id }) => {
    ctx.limiter.check();
    const details = await getPlaceDetails(ctx.apiKey, place_id);
    return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }] };
  },
};
