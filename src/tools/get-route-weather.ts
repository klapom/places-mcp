import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { computeRouteWeather } from "../upstream/route-weather-client.js";
import type { TravelMode } from "../upstream/routes-client.js";
import type { ToolsContext } from "./context.js";

const shape = {
  origin: z.string(),
  destination: z.string(),
  mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("DRIVE"),
  departure_time: z.string().optional(),
  interval_minutes: z.number().int().min(15).max(60).default(30),
};

export const getRouteWeatherTool: ToolDef<typeof shape, ToolsContext> = {
  name: "get_route_weather",
  description: "Show weather conditions along a driving route, sampled every 30 minutes.",
  shape,
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
