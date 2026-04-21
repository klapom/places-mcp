const BASE_URL = "https://places.googleapis.com/v1";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface PlaceSummary {
  id: string;
  name: string;
  address: string;
  rating?: number;
  userRatingCount?: number;
  types: string[];
  location?: LatLng;
  openNow?: boolean;
  priceLevel?: string;
  phone?: string;
  website?: string;
  googleMapsUri?: string;
}

const PRICE_LABELS: Record<string, string> = {
  PRICE_LEVEL_FREE: "kostenlos",
  PRICE_LEVEL_INEXPENSIVE: "günstig (€)",
  PRICE_LEVEL_MODERATE: "mittel (€€)",
  PRICE_LEVEL_EXPENSIVE: "teuer (€€€)",
  PRICE_LEVEL_VERY_EXPENSIVE: "sehr teuer (€€€€)",
};

// Fields requested for list results (minimal = cheaper API cost)
const LIST_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.location",
  "places.currentOpeningHours.openNow",
  "places.priceLevel",
  "places.googleMapsUri",
].join(",");

// Fields for detailed single-place lookup
const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "rating",
  "userRatingCount",
  "types",
  "location",
  "currentOpeningHours",
  "regularOpeningHours",
  "priceLevel",
  "nationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "editorialSummary",
  "accessibilityOptions",
  "parkingOptions",
  "paymentOptions",
  "dineIn",
  "takeout",
  "delivery",
  "reservable",
].join(",");

async function placesPost(
  apiKey: string,
  endpoint: string,
  body: unknown,
  fields: string,
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fields,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function placesGet(apiKey: string, path: string, fields: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/${path}?key=${apiKey}`, {
    headers: { "X-Goog-FieldMask": fields },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API error ${res.status}: ${err}`);
  }
  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPlace(p: any): PlaceSummary {
  return {
    id: p.id,
    name: p.displayName?.text ?? p.displayName ?? "",
    address: p.formattedAddress ?? "",
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    types: p.types ?? [],
    location: p.location,
    openNow: p.currentOpeningHours?.openNow,
    priceLevel: p.priceLevel ? (PRICE_LABELS[p.priceLevel] ?? p.priceLevel) : undefined,
    phone: p.nationalPhoneNumber,
    website: p.websiteUri,
    googleMapsUri: p.googleMapsUri,
  };
}

export async function searchText(
  apiKey: string,
  query: string,
  locationBias?: LatLng,
  radius?: number,
  maxResults = 10,
  languageCode = "de",
): Promise<PlaceSummary[]> {
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: maxResults,
    languageCode,
  };
  if (locationBias) {
    body.locationBias = {
      circle: {
        center: locationBias,
        radius: radius ?? 5000,
      },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await placesPost(apiKey, "places:searchText", body, LIST_FIELDS)) as any;
  return (data.places ?? []).map(mapPlace);
}

export async function searchNearby(
  apiKey: string,
  location: LatLng,
  radius: number,
  types: string[],
  maxResults = 10,
  languageCode = "de",
): Promise<PlaceSummary[]> {
  const body: Record<string, unknown> = {
    locationRestriction: {
      circle: { center: location, radius },
    },
    maxResultCount: maxResults,
    languageCode,
  };
  if (types.length > 0) body.includedTypes = types;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await placesPost(apiKey, "places:searchNearby", body, LIST_FIELDS)) as any;
  return (data.places ?? []).map(mapPlace);
}

export async function getPlaceDetails(
  apiKey: string,
  placeId: string,
  languageCode = "de",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const data = await placesGet(
    apiKey,
    `places/${placeId}?languageCode=${languageCode}`,
    DETAIL_FIELDS,
  );
  return data;
}

export async function autocomplete(
  apiKey: string,
  input: string,
  locationBias?: LatLng,
  languageCode = "de",
): Promise<{ placeId: string; description: string; types: string[] }[]> {
  const body: Record<string, unknown> = { input, languageCode };
  if (locationBias) {
    body.locationBias = {
      circle: { center: locationBias, radius: 50000 },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await placesPost(apiKey, "places:autocomplete", body, "*")) as any;
  return (data.suggestions ?? [])
    .filter((s: any) => s.placePrediction)
    .map((s: any) => ({
      placeId: s.placePrediction.placeId,
      description: s.placePrediction.text?.text ?? "",
      types: s.placePrediction.types ?? [],
    }));
}
