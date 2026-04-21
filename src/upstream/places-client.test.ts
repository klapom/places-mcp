import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autocomplete, getPlaceDetails, searchNearby, searchText } from "./places-client.js";

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

function errResponse(status: number, body: string) {
  return { ok: false, status, text: () => Promise.resolve(body), json: () => Promise.resolve({}) };
}

describe("searchText", () => {
  it("maps place fields correctly via mapPlace", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        places: [
          {
            id: "place123",
            displayName: { text: "Bäckerei Müller" },
            formattedAddress: "Hauptstr. 1, Berlin",
            rating: 4.5,
            userRatingCount: 120,
            types: ["bakery", "food"],
            location: { latitude: 52.52, longitude: 13.405 },
            currentOpeningHours: { openNow: true },
            priceLevel: "PRICE_LEVEL_INEXPENSIVE",
            googleMapsUri: "https://maps.google.com/place123",
          },
        ],
      }),
    );

    const results = await searchText("fake-key", "Bäckerei");
    expect(results).toHaveLength(1);
    const p = results[0];
    expect(p.id).toBe("place123");
    expect(p.name).toBe("Bäckerei Müller");
    expect(p.address).toBe("Hauptstr. 1, Berlin");
    expect(p.rating).toBe(4.5);
    expect(p.userRatingCount).toBe(120);
    expect(p.types).toEqual(["bakery", "food"]);
    expect(p.location).toEqual({ latitude: 52.52, longitude: 13.405 });
    expect(p.openNow).toBe(true);
    expect(p.priceLevel).toBe("günstig (€)");
    expect(p.googleMapsUri).toBe("https://maps.google.com/place123");
  });

  it("maps all PRICE_LABELS to German translations", async () => {
    const priceLevels = [
      ["PRICE_LEVEL_FREE", "kostenlos"],
      ["PRICE_LEVEL_INEXPENSIVE", "günstig (€)"],
      ["PRICE_LEVEL_MODERATE", "mittel (€€)"],
      ["PRICE_LEVEL_EXPENSIVE", "teuer (€€€)"],
      ["PRICE_LEVEL_VERY_EXPENSIVE", "sehr teuer (€€€€)"],
    ];

    for (const [level, label] of priceLevels) {
      mockFetch.mockResolvedValueOnce(
        okJson({
          places: [{ id: "x", displayName: "test", priceLevel: level }],
        }),
      );
      const results = await searchText("key", "test");
      expect(results[0].priceLevel).toBe(label);
    }
  });

  it("handles displayName as plain string", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        places: [{ id: "x", displayName: "Plain Name" }],
      }),
    );
    const results = await searchText("key", "test");
    expect(results[0].name).toBe("Plain Name");
  });

  it("returns empty array when no places", async () => {
    mockFetch.mockResolvedValueOnce(okJson({}));
    const results = await searchText("key", "test");
    expect(results).toEqual([]);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce(errResponse(403, "Forbidden"));
    await expect(searchText("key", "test")).rejects.toThrow("Places API error 403: Forbidden");
  });

  it("passes locationBias when provided", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ places: [] }));
    await searchText("key", "test", { latitude: 52, longitude: 13 }, 10000);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.locationBias.circle.center).toEqual({ latitude: 52, longitude: 13 });
    expect(body.locationBias.circle.radius).toBe(10000);
  });
});

describe("searchNearby", () => {
  it("sends correct request body", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ places: [] }));
    await searchNearby("key", { latitude: 48, longitude: 11 }, 3000, ["restaurant"]);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.locationRestriction.circle.center).toEqual({ latitude: 48, longitude: 11 });
    expect(body.locationRestriction.circle.radius).toBe(3000);
    expect(body.includedTypes).toEqual(["restaurant"]);
  });

  it("omits includedTypes when empty", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ places: [] }));
    await searchNearby("key", { latitude: 48, longitude: 11 }, 3000, []);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.includedTypes).toBeUndefined();
  });
});

describe("autocomplete", () => {
  it("maps suggestions correctly", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        suggestions: [
          { placePrediction: { placeId: "p1", text: { text: "Berlin" }, types: ["city"] } },
          { notAPlace: true },
        ],
      }),
    );
    const results = await autocomplete("key", "Ber");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ placeId: "p1", description: "Berlin", types: ["city"] });
  });
});

describe("getPlaceDetails", () => {
  it("returns raw data from API", async () => {
    const detail = { id: "p1", displayName: { text: "Test" } };
    mockFetch.mockResolvedValueOnce(okJson(detail));
    const result = await getPlaceDetails("key", "p1");
    expect(result).toEqual(detail);
  });
});
