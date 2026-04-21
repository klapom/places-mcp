import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeRouteWeather } from "./route-weather-client.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function routeResponse(steps: any[], totalSeconds: number) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        routes: [
          {
            duration: `${totalSeconds}s`,
            distanceMeters: 100000,
            localizedValues: { distance: { text: "100 km" }, duration: { text: "2 Std." } },
            legs: [
              {
                steps: steps.map((s) => ({
                  startLocation: { latLng: { latitude: s.startLat, longitude: s.startLng } },
                  endLocation: { latLng: { latitude: s.endLat, longitude: s.endLng } },
                  staticDuration: `${s.dur}s`,
                  navigationInstruction: { instructions: "Weiter" },
                })),
              },
            ],
          },
        ],
      }),
    text: () => Promise.resolve(""),
  };
}

function weatherResponse(temp: number, code: number, precip: number, wind: number) {
  const hours = Array.from({ length: 48 }, (_, i) => {
    const d = new Date("2026-02-19T00:00:00Z");
    d.setUTCHours(d.getUTCHours() + i);
    return d.toISOString().slice(0, 16);
  });
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        hourly: {
          time: hours,
          temperature_2m: hours.map(() => temp),
          weather_code: hours.map(() => code),
          precipitation_probability: hours.map(() => precip),
          wind_speed_10m: hours.map(() => wind),
        },
      }),
    text: () => Promise.resolve(""),
  };
}

describe("computeRouteWeather — sampleRoute behavior", () => {
  it("always includes Start and Ziel points", async () => {
    // 1 step, 20 min total (shorter than 30-min interval → no intermediate points)
    mockFetch
      .mockResolvedValueOnce(
        routeResponse(
          [{ startLat: 48.0, startLng: 11.0, endLat: 48.5, endLng: 11.5, dur: 1200 }],
          1200,
        ),
      )
      .mockResolvedValueOnce(weatherResponse(5, 0, 0, 10)) // Start
      .mockResolvedValueOnce(weatherResponse(3, 3, 20, 15)); // Ziel

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );

    expect(result).toContain("Start");
    expect(result).toContain("Ziel");
    // No intermediate points for a 20-min route
    expect(result).not.toContain("nach 30 Min.");
    // 2 weather fetches (Start + Ziel)
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 route + 2 weather
  });

  it("generates intermediate sample points at 30-min intervals", async () => {
    // 2 steps totaling 90 min → expect Start, 30min, 60min, Ziel
    mockFetch
      .mockResolvedValueOnce(
        routeResponse(
          [
            { startLat: 48.0, startLng: 11.0, endLat: 48.5, endLng: 11.5, dur: 3600 },
            { startLat: 48.5, startLng: 11.5, endLat: 49.0, endLng: 12.0, dur: 1800 },
          ],
          5400,
        ),
      )
      .mockResolvedValueOnce(weatherResponse(5, 0, 0, 10)) // Start
      .mockResolvedValueOnce(weatherResponse(4, 1, 5, 12)) // 30 min
      .mockResolvedValueOnce(weatherResponse(3, 2, 10, 14)) // 60 min
      .mockResolvedValueOnce(weatherResponse(2, 3, 30, 16)); // Ziel

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );

    expect(result).toContain("Start");
    expect(result).toContain("nach 30 Min.");
    expect(result).toContain("nach 1 Std.");
    expect(result).toContain("Ziel");
    expect(mockFetch).toHaveBeenCalledTimes(5); // 1 route + 4 weather
  });

  it("correctly interpolates lat/lng within a step", async () => {
    // Single step 60 min, sample at 30 min → fraction = 0.5
    // Start (48,11) → End (49,12), midpoint should be (48.5, 11.5)
    mockFetch
      .mockResolvedValueOnce(
        routeResponse(
          [{ startLat: 48.0, startLng: 11.0, endLat: 49.0, endLng: 12.0, dur: 3600 }],
          3600,
        ),
      )
      .mockResolvedValueOnce(weatherResponse(5, 0, 0, 10)) // Start
      .mockResolvedValueOnce(weatherResponse(4, 1, 5, 12)) // 30 min (midpoint)
      .mockResolvedValueOnce(weatherResponse(3, 2, 10, 14)); // Ziel

    await computeRouteWeather("key", "A", "B", "DRIVE", new Date("2026-02-19T10:00:00Z"), 30);

    // The 30-min weather fetch should be for the interpolated midpoint
    const weatherCalls = mockFetch.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("open-meteo"),
    );
    expect(weatherCalls).toHaveLength(3);
    // Second weather call (30 min point) should have lat ~48.5, lng ~11.5
    const url = new URL(weatherCalls[1][0]);
    expect(Number.parseFloat(url.searchParams.get("latitude")!)).toBeCloseTo(48.5, 1);
    expect(Number.parseFloat(url.searchParams.get("longitude")!)).toBeCloseTo(11.5, 1);
  });
});

describe("computeRouteWeather — formatOffsetLabel", () => {
  it("formats 30 min as '30 Min.'", async () => {
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 49, endLng: 12, dur: 3600 }], 3600),
      )
      .mockResolvedValueOnce(weatherResponse(5, 0, 0, 10))
      .mockResolvedValueOnce(weatherResponse(4, 1, 5, 12))
      .mockResolvedValueOnce(weatherResponse(3, 2, 10, 14));

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    expect(result).toContain("nach 30 Min.");
  });

  it("formats 60 min as '1 Std.'", async () => {
    // 2h route, 30-min interval → Start, 30m, 60m, 90m, Ziel = 5 weather calls
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 49, endLng: 12, dur: 7200 }], 7200),
      )
      .mockResolvedValueOnce(weatherResponse(5, 0, 0, 10))
      .mockResolvedValueOnce(weatherResponse(4, 1, 5, 12))
      .mockResolvedValueOnce(weatherResponse(3, 2, 10, 14))
      .mockResolvedValueOnce(weatherResponse(2, 3, 30, 16))
      .mockResolvedValueOnce(weatherResponse(1, 0, 0, 8));

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    expect(result).toContain("nach 1 Std.");
  });

  it("formats 90 min as '1 Std. 30 Min.'", async () => {
    // 2h route, 30-min interval → Start, 30m, 60m, 90m, Ziel = 5 weather calls
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 49, endLng: 12, dur: 7200 }], 7200),
      )
      .mockResolvedValueOnce(weatherResponse(5, 0, 0, 10))
      .mockResolvedValueOnce(weatherResponse(4, 1, 5, 12))
      .mockResolvedValueOnce(weatherResponse(3, 2, 10, 14))
      .mockResolvedValueOnce(weatherResponse(2, 3, 30, 16))
      .mockResolvedValueOnce(weatherResponse(1, 0, 0, 8));

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    expect(result).toContain("nach 1 Std. 30 Min.");
  });
});

describe("computeRouteWeather — WMO codes", () => {
  it("maps WMO code 0 to clear sky", async () => {
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 48.1, endLng: 11.1, dur: 600 }], 600),
      )
      .mockResolvedValueOnce(weatherResponse(10, 0, 0, 5))
      .mockResolvedValueOnce(weatherResponse(10, 0, 0, 5));

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    expect(result).toContain("Klarer Himmel");
  });

  it("maps WMO code 95 to Gewitter", async () => {
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 48.1, endLng: 11.1, dur: 600 }], 600),
      )
      .mockResolvedValueOnce(weatherResponse(15, 95, 80, 30))
      .mockResolvedValueOnce(weatherResponse(15, 95, 80, 30));

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    expect(result).toContain("Gewitter");
  });

  it("falls back to 'Code N' for unknown WMO codes", async () => {
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 48.1, endLng: 11.1, dur: 600 }], 600),
      )
      .mockResolvedValueOnce(weatherResponse(10, 999, 0, 5))
      .mockResolvedValueOnce(weatherResponse(10, 999, 0, 5));

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    expect(result).toContain("Code 999");
  });
});

describe("computeRouteWeather — output format", () => {
  it("includes mode label, origin, destination, and departure", async () => {
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 48.1, endLng: 11.1, dur: 600 }], 600),
      )
      .mockResolvedValueOnce(weatherResponse(10, 0, 0, 5))
      .mockResolvedValueOnce(weatherResponse(10, 0, 0, 5));

    const result = await computeRouteWeather(
      "key",
      "München",
      "Nürnberg",
      "WALK",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    expect(result).toContain("Zu Fuß");
    expect(result).toContain("München → Nürnberg");
    expect(result).toContain("Abfahrt:");
  });

  it("shows rain probability when > 20%", async () => {
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 48.1, endLng: 11.1, dur: 600 }], 600),
      )
      .mockResolvedValueOnce(weatherResponse(10, 61, 50, 5))
      .mockResolvedValueOnce(weatherResponse(10, 61, 50, 5));

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    expect(result).toContain("50%");
  });

  it("hides rain probability when <= 20%", async () => {
    mockFetch
      .mockResolvedValueOnce(
        routeResponse([{ startLat: 48, startLng: 11, endLat: 48.1, endLng: 11.1, dur: 600 }], 600),
      )
      .mockResolvedValueOnce(weatherResponse(10, 0, 15, 5))
      .mockResolvedValueOnce(weatherResponse(10, 0, 15, 5));

    const result = await computeRouteWeather(
      "key",
      "A",
      "B",
      "DRIVE",
      new Date("2026-02-19T10:00:00Z"),
      30,
    );
    // Should not contain precipitation info line
    expect(result).not.toContain("15%");
  });
});
