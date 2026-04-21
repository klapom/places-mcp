/**
 * Weather along a route — samples the weather every 30 minutes
 * by combining the Google Routes API (step coordinates + durations)
 * with Open-Meteo hourly forecasts for each sampled position.
 */

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

// Field mask: step locations + durations so we can interpolate position
const ROUTE_FIELDS = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.localizedValues",
  "routes.legs.steps.startLocation",
  "routes.legs.steps.endLocation",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.navigationInstruction",
].join(",");

export type TravelMode = "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT";

interface Step {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  durationSeconds: number;
  instruction?: string;
}

interface SamplePoint {
  offsetMinutes: number; // minutes after departure
  expectedTime: Date;
  lat: number;
  lng: number;
  label: string; // "Start", "nach 30 Min.", "Ziel"
}

interface WeatherSnapshot {
  offsetMinutes: number;
  timeLabel: string; // "14:30"
  locationLabel: string;
  temperature: number;
  condition: string;
  precipitationProbability: number;
  windSpeed: number;
}

// ─── Routes API ──────────────────────────────────────────────────────────────

async function fetchRouteSteps(
  apiKey: string,
  origin: string,
  destination: string,
  mode: TravelMode,
): Promise<{ steps: Step[]; totalSeconds: number; summary: string }> {
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
    throw new Error(`Routes API ${res.status}: ${err}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const route = data.routes?.[0];
  if (!route) throw new Error("Keine Route gefunden.");

  const totalSeconds = Number.parseInt(route.duration?.replace("s", "") ?? "0");
  const summary =
    `${route.localizedValues?.distance?.text ?? ""}, ` +
    `${route.localizedValues?.duration?.text ?? ""}`;

  const steps: Step[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const dur = Number.parseInt(step.staticDuration?.replace("s", "") ?? "0");
      if (!step.startLocation?.latLng || !step.endLocation?.latLng) continue;
      steps.push({
        startLat: step.startLocation.latLng.latitude,
        startLng: step.startLocation.latLng.longitude,
        endLat: step.endLocation.latLng.latitude,
        endLng: step.endLocation.latLng.longitude,
        durationSeconds: dur,
        instruction: step.navigationInstruction?.instructions,
      });
    }
  }

  return { steps, totalSeconds, summary };
}

// ─── Route sampling ──────────────────────────────────────────────────────────

function sampleRoute(
  steps: Step[],
  totalSeconds: number,
  departureTime: Date,
  intervalMinutes: number,
): SamplePoint[] {
  const points: SamplePoint[] = [];
  const intervalSeconds = intervalMinutes * 60;

  // Always include departure (t=0)
  const firstStep = steps[0];
  if (firstStep) {
    points.push({
      offsetMinutes: 0,
      expectedTime: new Date(departureTime),
      lat: firstStep.startLat,
      lng: firstStep.startLng,
      label: "Start",
    });
  }

  let cumSeconds = 0;
  let nextSampleAt = intervalSeconds;
  let stepIdx = 0;

  while (nextSampleAt < totalSeconds && stepIdx < steps.length) {
    const step = steps[stepIdx];
    if (!step) break;

    if (cumSeconds + step.durationSeconds >= nextSampleAt) {
      // Sample point falls within this step — interpolate position
      const fraction = (nextSampleAt - cumSeconds) / step.durationSeconds;
      const lat = step.startLat + fraction * (step.endLat - step.startLat);
      const lng = step.startLng + fraction * (step.endLng - step.startLng);
      const expectedTime = new Date(departureTime.getTime() + nextSampleAt * 1000);
      const offsetMinutes = Math.round(nextSampleAt / 60);
      points.push({
        offsetMinutes,
        expectedTime,
        lat,
        lng,
        label: `nach ${formatOffsetLabel(offsetMinutes)}`,
      });
      nextSampleAt += intervalSeconds;
      // Don't advance stepIdx — there might be more samples in this step
    } else {
      cumSeconds += step.durationSeconds;
      stepIdx++;
    }
  }

  // Always include destination
  const lastStep = steps[steps.length - 1];
  if (lastStep) {
    points.push({
      offsetMinutes: Math.round(totalSeconds / 60),
      expectedTime: new Date(departureTime.getTime() + totalSeconds * 1000),
      lat: lastStep.endLat,
      lng: lastStep.endLng,
      label: "Ziel",
    });
  }

  return points;
}

function formatOffsetLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

// ─── Open-Meteo hourly weather ────────────────────────────────────────────────

const WMO: Record<number, string> = {
  0: "☀️ Klarer Himmel",
  1: "🌤️ Überwiegend klar",
  2: "⛅ Teilweise bewölkt",
  3: "☁️ Bedeckt",
  45: "🌫️ Nebel",
  48: "🌫️ Reifnebel",
  51: "🌦️ Nieselregen",
  53: "🌦️ Nieselregen",
  55: "🌧️ Starker Nieselregen",
  61: "🌧️ Leichter Regen",
  63: "🌧️ Regen",
  65: "🌧️ Starker Regen",
  71: "🌨️ Leichter Schnee",
  73: "❄️ Schneefall",
  75: "❄️ Starker Schneefall",
  80: "🌦️ Regenschauer",
  81: "🌧️ Regenschauer",
  82: "⛈️ Starke Schauer",
  95: "⛈️ Gewitter",
  96: "⛈️ Gewitter+Hagel",
  99: "⛈️ Starkes Gewitter",
};

async function getWeatherAtPointAndTime(
  lat: number,
  lng: number,
  targetTime: Date,
): Promise<{ temperature: number; condition: string; precipProb: number; windSpeed: number }> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    timezone: "Europe/Berlin",
    hourly: "temperature_2m,weather_code,precipitation_probability,wind_speed_10m",
    forecast_days: "2",
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;

  // Find the hourly slot closest to targetTime
  const targetMs = targetTime.getTime();
  let closestIdx = 0;
  let closestDiff = Number.POSITIVE_INFINITY;

  for (let i = 0; i < data.hourly.time.length; i++) {
    const slotMs = new Date(data.hourly.time[i]).getTime();
    const diff = Math.abs(slotMs - targetMs);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIdx = i;
    }
  }

  const code: number = data.hourly.weather_code[closestIdx];
  return {
    temperature: Math.round(data.hourly.temperature_2m[closestIdx]),
    condition: WMO[code] ?? `Code ${code}`,
    precipProb: data.hourly.precipitation_probability[closestIdx] ?? 0,
    windSpeed: Math.round(data.hourly.wind_speed_10m[closestIdx]),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function computeRouteWeather(
  apiKey: string,
  origin: string,
  destination: string,
  mode: TravelMode,
  departureTime: Date,
  intervalMinutes: number,
): Promise<string> {
  const { steps, totalSeconds, summary } = await fetchRouteSteps(apiKey, origin, destination, mode);

  const samplePoints = sampleRoute(steps, totalSeconds, departureTime, intervalMinutes);

  // Fetch weather for all points (sequentially to avoid hammering the API)
  const snapshots: WeatherSnapshot[] = [];
  for (const point of samplePoints) {
    const w = await getWeatherAtPointAndTime(point.lat, point.lng, point.expectedTime);
    snapshots.push({
      offsetMinutes: point.offsetMinutes,
      timeLabel: formatLocalTime(point.expectedTime),
      locationLabel: point.label,
      temperature: w.temperature,
      condition: w.condition,
      precipitationProbability: w.precipProb,
      windSpeed: w.windSpeed,
    });
  }

  // Format output
  const modeLabel: Record<TravelMode, string> = {
    DRIVE: "🚗 Auto",
    WALK: "🚶 Zu Fuß",
    BICYCLE: "🚲 Fahrrad",
    TRANSIT: "🚌 ÖPNV",
  };
  const depLabel = formatLocalTime(departureTime);

  const lines = snapshots.map((s) => {
    const rain = s.precipitationProbability > 20 ? `  🌧 ${s.precipitationProbability}%` : "";
    return (
      `${s.timeLabel}  ${s.locationLabel}\n` +
      `  ${s.condition}  ${s.temperature}°C  💨 ${s.windSpeed} km/h${rain}`
    );
  });

  return `Wetter entlang der Route (${modeLabel[mode]})\n${origin} → ${destination}\nAbfahrt: ${depLabel}  |  ${summary}\n${"─".repeat(40)}\n${lines.join("\n\n")}`;
}

function formatLocalTime(date: Date): string {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
