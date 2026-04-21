import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetchSequence } from "../test-utils.js";
import { buildTestContext } from "./__test-helpers.js";
import { autocompletePlaceTool } from "./autocomplete-place.js";
import { computeRouteTool } from "./compute-route.js";
import { getPlaceDetailsTool } from "./get-place-details.js";
import { getRouteWeatherTool } from "./get-route-weather.js";
import { searchNearbyTool } from "./search-nearby.js";
import { searchPlacesTool } from "./search-places.js";
import { usageStatusTool } from "./usage-status.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("search_places", () => {
  it("returns formatted results", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        places: [
          {
            id: "p1",
            displayName: { text: "Pizza Roma" },
            formattedAddress: "Hauptstr. 1",
            rating: 4.5,
          },
        ],
      }),
    );
    const ctx = buildTestContext();
    const result = await searchPlacesTool.handler(ctx, {
      query: "pizza",
      radius_meters: 5000,
      max_results: 5,
    });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Pizza Roma");
  });

  it("returns empty-hint when no results", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ places: [] }));
    const ctx = buildTestContext();
    const result = await searchPlacesTool.handler(ctx, {
      query: "nothing",
      radius_meters: 5000,
      max_results: 5,
    });
    expect(result.content[0]?.text).toContain("Keine Ergebnisse");
  });

  it("uses default location when hasDefaultLocation true", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ places: [] }));
    const ctx = buildTestContext({ hasDefaultLocation: true });
    await searchPlacesTool.handler(ctx, {
      query: "x",
      radius_meters: 5000,
      max_results: 5,
    });
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(body.locationBias).toBeDefined();
  });
});

describe("search_nearby", () => {
  it("returns formatted list", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        places: [{ id: "p1", displayName: { text: "Café" }, formattedAddress: "Platz 1" }],
      }),
    );
    const ctx = buildTestContext();
    const result = await searchNearbyTool.handler(ctx, {
      latitude: 48,
      longitude: 11,
      types: [],
      radius_meters: 500,
      max_results: 5,
    });
    expect(result.content[0]?.text).toContain("Café");
  });

  it("returns empty-hint when nothing found", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ places: [] }));
    const ctx = buildTestContext();
    const result = await searchNearbyTool.handler(ctx, {
      latitude: 0,
      longitude: 0,
      types: [],
      radius_meters: 500,
      max_results: 5,
    });
    expect(result.content[0]?.text).toContain("Keine Orte");
  });
});

describe("get_place_details", () => {
  it("returns JSON of details", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "abc",
        displayName: { text: "Landtag" },
        formattedAddress: "X 1",
      }),
    );
    const ctx = buildTestContext();
    const result = await getPlaceDetailsTool.handler(ctx, { place_id: "abc" });
    expect(result.content[0]?.text).toContain("Landtag");
  });
});

describe("autocomplete_place", () => {
  it("returns suggestions", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        suggestions: [
          {
            placePrediction: {
              placeId: "p1",
              text: { text: "Berlin" },
              structuredFormat: {
                mainText: { text: "Berlin" },
                secondaryText: { text: "Deutschland" },
              },
            },
          },
        ],
      }),
    );
    const ctx = buildTestContext();
    const result = await autocompletePlaceTool.handler(ctx, { input: "ber" });
    expect(result.content[0]?.text).toContain("Berlin");
  });

  it("returns empty-hint when no suggestions", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ suggestions: [] }));
    const ctx = buildTestContext({ hasDefaultLocation: true });
    const result = await autocompletePlaceTool.handler(ctx, { input: "x" });
    expect(result.content[0]?.text).toContain("Keine Vorschläge");
  });
});

describe("compute_route", () => {
  it("returns formatted route text", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        routes: [
          {
            localizedValues: {
              duration: { text: "45 Min." },
              distance: { text: "50 km" },
            },
            legs: [
              {
                steps: [{ navigationInstruction: { instructions: "Links abbiegen" } }],
              },
            ],
          },
        ],
      }),
    );
    const ctx = buildTestContext();
    const result = await computeRouteTool.handler(ctx, {
      origin: "A",
      destination: "B",
      mode: "DRIVE",
    });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Dauer: 45 Min.");
    expect(text).toContain("Entfernung: 50 km");
    expect(text).toContain("Google Maps");
  });
});

describe("get_route_weather", () => {
  it("delegates to computeRouteWeather and returns text", async () => {
    // route-weather-client needs: Routes API call + Open-Meteo calls per sample point
    const routeFixture = jsonResponse({
      routes: [
        {
          duration: "1800s",
          distanceMeters: 25000,
          localizedValues: {
            duration: { text: "30 Min." },
            distance: { text: "25 km" },
          },
          legs: [
            {
              steps: [
                {
                  staticDuration: "1800s",
                  startLocation: { latLng: { latitude: 48.1, longitude: 11.5 } },
                  endLocation: { latLng: { latitude: 48.2, longitude: 11.6 } },
                  navigationInstruction: { instructions: "drive" },
                },
              ],
            },
          ],
        },
      ],
    });
    const weatherFixture = () =>
      jsonResponse({
        hourly: {
          time: ["2026-04-21T12:00", "2026-04-21T13:00"],
          temperature_2m: [12, 14],
          weather_code: [1, 1],
          precipitation_probability: [0, 0],
          wind_speed_10m: [5, 5],
        },
      });
    mockFetch
      .mockResolvedValueOnce(routeFixture)
      .mockResolvedValueOnce(weatherFixture())
      .mockResolvedValueOnce(weatherFixture())
      .mockResolvedValueOnce(weatherFixture());
    const ctx = buildTestContext();
    const result = await getRouteWeatherTool.handler(ctx, {
      origin: "Muc",
      destination: "Gar",
      mode: "DRIVE",
      interval_minutes: 30,
    });
    expect(result.content[0]?.text).toBeTypeOf("string");
  });
});

describe("usage_status", () => {
  it("returns quota text", async () => {
    const ctx = buildTestContext();
    const result = await usageStatusTool.handler(ctx, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Places API Nutzung");
    expect(text).toContain("Diese Stunde");
    expect(text).toContain("Dieser Monat");
  });
});

// Silence unused-import warnings
void mockFetchSequence;
