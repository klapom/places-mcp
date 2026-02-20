# places-mcp

Google Places & Routes MCP Server for Claude Desktop and Claude Code. Search places, get directions, and compute route weather via natural language.

## Features
- Search nearby places (restaurants, hotels, shops, etc.)
- Get place details, ratings, opening hours
- Compute routes with turn-by-turn directions
- Route weather: weather forecast at each waypoint along a route

## Configuration
Copy `.env.example` to `.env`:
- `GOOGLE_PLACES_API_KEY` — Google Maps Platform API key (enable Places API + Routes API)
- `MAX_REQUESTS_PER_HOUR` / `MAX_REQUESTS_PER_MONTH` — rate limiting

## Usage with mcporter
Add to `~/.mcporter/mcporter.json`:
```json
"places": {
  "command": "node --env-file=/path/to/places-mcp/.env /path/to/places-mcp/dist/index.js"
}
```
