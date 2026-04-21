/**
 * Shared test helpers for places-mcp tool-handler tests.
 *
 * Tools mock `globalThis.fetch` via `vi.fn()` and feed responses through
 * these helpers. Response objects are stateful (body can only be read once),
 * so wrap fixtures as factories: `const fix = () => jsonResponse({...})`.
 *
 * ToolsContext construction is service-specific (API key, rate limiter,
 * default location) and lives inline in each test file.
 */

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(
  status = 500,
  statusText = "Internal Server Error",
  body = "",
): Response {
  return new Response(body, { status, statusText });
}

export function mockFetchSequence(responses: Response[]): typeof globalThis.fetch {
  let i = 0;
  return (async () => {
    const r = responses[i];
    i += 1;
    if (!r) throw new Error(`mockFetchSequence exhausted after ${i - 1} calls`);
    return r;
  }) as typeof globalThis.fetch;
}
