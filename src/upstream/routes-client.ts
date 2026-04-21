const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

const ROUTE_FIELDS = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.localizedValues",
  "routes.legs.steps.navigationInstruction",
  "routes.legs.steps.localizedValues",
  "routes.legs.localizedValues",
].join(",");

export type TravelMode = "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT";

export interface RouteResult {
  durationText: string;
  distanceText: string;
  steps: string[];
  mapsLink: string;
}

export async function computeRoute(
  apiKey: string,
  origin: string,
  destination: string,
  mode: TravelMode = "DRIVE",
): Promise<RouteResult> {
  const res = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": ROUTE_FIELDS,
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      travelMode: mode,
      languageCode: "de",
      units: "METRIC",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Routes API error ${res.status}: ${err}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const route = data.routes?.[0];
  if (!route) throw new Error("Keine Route gefunden.");

  const durationText =
    route.localizedValues?.duration?.text ??
    formatSeconds(Number.parseInt(route.duration?.replace("s", "") ?? "0"));
  const distanceText =
    route.localizedValues?.distance?.text ?? formatMeters(route.distanceMeters ?? 0);

  // Collect turn-by-turn steps
  const steps: string[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const instruction = step.navigationInstruction?.instructions;
      const dist = step.localizedValues?.distance?.text;
      if (instruction) {
        steps.push(dist ? `${instruction} (${dist})` : instruction);
      }
    }
  }

  // Build deep link for Google Maps
  const mapsLink = buildMapsLink(origin, destination, mode);

  return { durationText, distanceText, steps, mapsLink };
}

function buildMapsLink(origin: string, destination: string, mode: TravelMode): string {
  const modeMap: Record<TravelMode, string> = {
    DRIVE: "driving",
    WALK: "walking",
    BICYCLE: "bicycling",
    TRANSIT: "transit",
  };
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: modeMap[mode],
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s} Sek.`;
  if (s < 3600) return `${Math.round(s / 60)} Min.`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m > 0 ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

function formatMeters(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
