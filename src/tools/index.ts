import type { RestHandler, ToolDef, ToolResult } from "@klapom/mcp-toolkit-ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { autocompletePlaceTool } from "./autocomplete-place.js";
import { computeRouteTool } from "./compute-route.js";
import type { ToolsContext } from "./context.js";
import { getPlaceDetailsTool } from "./get-place-details.js";
import { getRouteWeatherTool } from "./get-route-weather.js";
import { searchNearbyTool } from "./search-nearby.js";
import { searchPlacesTool } from "./search-places.js";
import { usageStatusTool } from "./usage-status.js";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
const ALL_TOOLS: Array<ToolDef<any, ToolsContext>> = [
  searchPlacesTool,
  searchNearbyTool,
  getPlaceDetailsTool,
  autocompletePlaceTool,
  computeRouteTool,
  getRouteWeatherTool,
  usageStatusTool,
];

export function toolNames(): string[] {
  return ALL_TOOLS.map((t) => t.name);
}

export function registerTools(server: McpServer, ctx: ToolsContext): void {
  for (const def of ALL_TOOLS) {
    server.tool(def.name, def.description, def.shape, (args: unknown) =>
      def.handler(ctx, args as never),
    );
  }
}

export function buildRestHandlers(ctx: ToolsContext): {
  handlers: Record<string, RestHandler>;
  names: string[];
} {
  const handlers: Record<string, RestHandler> = {};
  const names: string[] = [];
  for (const def of ALL_TOOLS) {
    names.push(def.name);
    handlers[def.name] = async (rawArgs): Promise<ToolResult> => {
      const parsed = z.object(def.shape).parse(rawArgs ?? {});
      return def.handler(ctx, parsed as never);
    };
  }
  return { handlers, names };
}
