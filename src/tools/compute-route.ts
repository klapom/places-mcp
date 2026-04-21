import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { type TravelMode, computeRoute } from "../upstream/routes-client.js";
import type { ToolsContext } from "./context.js";

const shape = {
  origin: z.string(),
  destination: z.string(),
  mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("DRIVE"),
};

export const computeRouteTool: ToolDef<typeof shape, ToolsContext> = {
  name: "compute_route",
  description:
    "Calculate a route between two addresses; returns duration, distance, turn-by-turn and a Google Maps link.",
  shape,
  handler: async (ctx, { origin, destination, mode }) => {
    ctx.limiter.check();
    const route = await computeRoute(ctx.apiKey, origin, destination, mode as TravelMode);
    const stepsText =
      route.steps.length > 0
        ? `\n\nAbbiegungen:\n${route.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
        : "";
    const text =
      `Route: ${origin} → ${destination}\n` +
      `Dauer: ${route.durationText}\n` +
      `Entfernung: ${route.distanceText}\n` +
      `\nGoogle Maps öffnen:\n${route.mapsLink}${stepsText}`;
    return { content: [{ type: "text", text }] };
  },
};
