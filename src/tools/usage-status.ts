import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import type { ToolsContext } from "./context.js";

const shape = {};

export const usageStatusTool: ToolDef<typeof shape, ToolsContext> = {
  name: "usage_status",
  description: "Show current API usage and remaining quota for this hour and month.",
  shape,
  handler: async (ctx) => {
    const s = ctx.limiter.status();
    const hourRemaining = s.hourLimit - s.hourUsed;
    const monthRemaining = s.monthLimit - s.monthUsed;
    const monthPct = ((s.monthUsed / s.monthLimit) * 100).toFixed(1);
    const text = `Places API Nutzung:\n  Diese Stunde:  ${s.hourUsed} / ${s.hourLimit} (${hourRemaining} verbleibend)\n  Dieser Monat:  ${s.monthUsed} / ${s.monthLimit} (${monthPct}% verbraucht, ${monthRemaining} verbleibend)\n  Monat:         ${s.monthKey}`;
    return { content: [{ type: "text", text }] };
  },
};
