import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeRoute } from "./routes-client.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function okJson(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve("") };
}

describe("computeRoute", () => {
  it("returns formatted route with steps and maps link", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        routes: [
          {
            duration: "3600s",
            distanceMeters: 50000,
            localizedValues: {
              duration: { text: "1 Std." },
              distance: { text: "50,0 km" },
            },
            legs: [
              {
                steps: [
                  {
                    navigationInstruction: { instructions: "Auf A9 auffahren" },
                    localizedValues: { distance: { text: "30 km" } },
                  },
                  {
                    navigationInstruction: { instructions: "Ausfahrt nehmen" },
                    localizedValues: { distance: { text: "500 m" } },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const result = await computeRoute("key", "München", "Nürnberg", "DRIVE");
    expect(result.durationText).toBe("1 Std.");
    expect(result.distanceText).toBe("50,0 km");
    expect(result.steps).toEqual(["Auf A9 auffahren (30 km)", "Ausfahrt nehmen (500 m)"]);
    expect(result.mapsLink).toContain("google.com/maps/dir");
    expect(result.mapsLink).toContain("travelmode=driving");
  });

  it("falls back to formatSeconds/formatMeters when localizedValues missing", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        routes: [
          {
            duration: "5400s",
            distanceMeters: 800,
            legs: [],
          },
        ],
      }),
    );

    const result = await computeRoute("key", "A", "B");
    expect(result.durationText).toBe("1 Std. 30 Min.");
    expect(result.distanceText).toBe("800 m");
  });

  it("formatSeconds handles edge cases via fallback", async () => {
    // < 60 seconds
    mockFetch.mockResolvedValueOnce(
      okJson({
        routes: [{ duration: "45s", distanceMeters: 1500, legs: [] }],
      }),
    );
    let result = await computeRoute("key", "A", "B");
    expect(result.durationText).toBe("45 Sek.");
    expect(result.distanceText).toBe("1.5 km");

    // minutes only
    mockFetch.mockResolvedValueOnce(
      okJson({
        routes: [{ duration: "300s", distanceMeters: 0, legs: [] }],
      }),
    );
    result = await computeRoute("key", "A", "B");
    expect(result.durationText).toBe("5 Min.");

    // exact hours
    mockFetch.mockResolvedValueOnce(
      okJson({
        routes: [{ duration: "7200s", distanceMeters: 100000, legs: [] }],
      }),
    );
    result = await computeRoute("key", "A", "B");
    expect(result.durationText).toBe("2 Std.");
    expect(result.distanceText).toBe("100.0 km");
  });

  it("throws when no route found", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ routes: [] }));
    await expect(computeRoute("key", "A", "B")).rejects.toThrow("Keine Route gefunden");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve("Bad") });
    await expect(computeRoute("key", "A", "B")).rejects.toThrow("Routes API error 400: Bad");
  });

  it("buildMapsLink maps travel modes correctly", async () => {
    const modes = [
      ["DRIVE", "driving"],
      ["WALK", "walking"],
      ["BICYCLE", "bicycling"],
      ["TRANSIT", "transit"],
    ] as const;

    for (const [mode, expected] of modes) {
      mockFetch.mockResolvedValueOnce(
        okJson({
          routes: [{ duration: "60s", distanceMeters: 100, legs: [] }],
        }),
      );
      const result = await computeRoute("key", "A", "B", mode);
      expect(result.mapsLink).toContain(`travelmode=${expected}`);
    }
  });

  it("buildMapsLink encodes special characters", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        routes: [{ duration: "60s", distanceMeters: 100, legs: [] }],
      }),
    );
    const result = await computeRoute("key", "München Hbf", "Köln Hbf");
    expect(result.mapsLink).toContain("M%C3%BCnchen");
    expect(result.mapsLink).toContain("K%C3%B6ln");
  });

  it("skips steps without instructions", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        routes: [
          {
            duration: "60s",
            distanceMeters: 100,
            legs: [
              {
                steps: [
                  { localizedValues: { distance: { text: "10 m" } } },
                  { navigationInstruction: { instructions: "Links" } },
                ],
              },
            ],
          },
        ],
      }),
    );
    const result = await computeRoute("key", "A", "B");
    expect(result.steps).toEqual(["Links"]);
  });
});
