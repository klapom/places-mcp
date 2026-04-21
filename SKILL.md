# places-mcp

MCP-Server für Google Places (New) + Google Routes + Wetter entlang Route (Open-Meteo). 7 Tools für Orts-Suche, Detail-Lookup, Autocomplete, Routen-Berechnung, Routen-Wetter und Nutzungs-Status.

## Endpoints

| Surface | URL | Auth |
|---|---|---|
| REST | `http://<host>:32610` | LAN / CF-Access-Token `places-token` |
| MCP Streamable-HTTP | `http://<host>:33610/mcp` | LAN / CF-Access-Token `places-token` |
| MCP stdio | `node --env-file=.env dist/index.js` | — (lokaler Prozess für Claude Desktop) |

Pfad-Konvention: `/mcp` ohne trailing slash (Node-SDK — siehe PORT_REGISTRY.md in mcp-platform).
Public hostnames (CF-Tunnel): `api-places.pommerconsulting.de` (REST), `mcp-places.pommerconsulting.de` (MCP).

## Tools

| Name | Zweck | Input |
|---|---|---|
| `search_places` | Text-Suche ("Pizza München") | `{ "query": "...", "near_lat"?: n, "near_lng"?: n, "radius_meters"?: 5000, "max_results"?: 5 }` |
| `search_nearby` | Orte um Koordinaten | `{ "latitude": n, "longitude": n, "types"?: ["cafe"], "radius_meters"?: 1000, "max_results"?: 5 }` |
| `get_place_details` | Volle Details zu Place-ID | `{ "place_id": "..." }` |
| `autocomplete_place` | Eingabe-Vorschläge | `{ "input": "...", "near_lat"?: n, "near_lng"?: n }` |
| `compute_route` | Route zwischen 2 Adressen + Maps-Link | `{ "origin": "...", "destination": "...", "mode"?: "DRIVE\|WALK\|BICYCLE\|TRANSIT" }` |
| `get_route_weather` | Wetter entlang Route (Sampling) | `{ "origin": "...", "destination": "...", "mode"?: "DRIVE", "departure_time"?: "ISO", "interval_minutes"?: 30 }` |
| `usage_status` | Aktuelle API-Nutzung + Quota | `{}` |

Default-Location (`DEFAULT_LAT` / `DEFAULT_LNG`) wird als Location-Bias für `search_places` / `autocomplete_place` verwendet, wenn nicht explizit angegeben.

## Beispiel-Calls (REST)

```bash
# Text-Suche
curl -fsS -X POST http://localhost:32610/tools/search_places \
  -H 'content-type: application/json' \
  -d '{"query":"Bäckerei","near_lat":48.13,"near_lng":11.57,"radius_meters":1000}'

# Route + Wetter
curl -fsS -X POST http://localhost:32610/tools/get_route_weather \
  -H 'content-type: application/json' \
  -d '{"origin":"München","destination":"Garmisch","mode":"DRIVE"}'

# Quota
curl -fsS -X POST http://localhost:32610/tools/usage_status \
  -H 'content-type: application/json' -d '{}'
```

## Rate-Limit

Token-Bucket-artiger Counter auf Dateiebene (`~/.places-mcp/usage.json`):

- `MAX_REQUESTS_PER_HOUR` (default 60)
- `MAX_REQUESTS_PER_MONTH` (default 5000)

Jeder Tool-Call außer `usage_status` zählt einen Request. Überschreitung wirft Error mit verbleibender Zeit bis zum nächsten Reset.

## Env

| Variable | Default | Pflicht |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | — | ✅ |
| `LISTEN_PORT` | 32610 | |
| `MCP_PORT` | 33610 | |
| `LISTEN_HOST` | 0.0.0.0 | |
| `DEFAULT_LAT` | — | optional (Bias) |
| `DEFAULT_LNG` | — | optional (Bias) |
| `MAX_REQUESTS_PER_HOUR` | 60 | |
| `MAX_REQUESTS_PER_MONTH` | 5000 | |
| `USAGE_FILE` | `~/.places-mcp/usage.json` | |
| `LOG_LEVEL` | info | |
