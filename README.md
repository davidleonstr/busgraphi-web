# Busgraphi web page (Laravel)

A single-page trip planner for El Salvador's buses, with two clearly separated modes:

| | **Manual** (navy) | **Assistant** (teal) |
|-|-|-|
| Left panel | Trip planner (search / click stops, options, step-by-step result) and a Routes browser | Chat with the AI assistant (Markdown replies, optional location sharing) |
| Map | Every stop and route line, **fully interactive**: click a stop or any point to set From / To, click a line to highlight a route | Every stop and route line is **visible but inert**: no clicks, no hover, no popups. Only the chat drives the map |
| Result on map | Your planned trip | The trip the assistant planned (also re-drawable from "Show route on map" under each reply) |

Messages are visually distinct: **You** = right-aligned navy bubble, **Assistant** = left-aligned teal card with an "AI" avatar, rendered as sanitised Markdown (marked + DOMPurify).

The browser only talks to Laravel. Laravel calls your two backends:

* **Routes API** (`sv-bus-api`): always sent with `X-API-Key` (from `ROUTING_API_KEY`, never exposed to the browser).
* **Assistant API** (`sv-bus-assistant`): no API key.

## Install (Laravel 10, 11 or 12, PHP 8.1+)

```bash
composer create-project laravel/laravel busgraphi-web      # or use an existing app
# unzip this archive on top of the project (merge folders)
cat .env.busgraphi.example >> .env                          # then edit ROUTING_API_KEY etc.
php artisan config:clear
php artisan serve                                           # http://127.0.0.1:8000  (use --port=8080 if 8000 is your Routes API)
```

`routes/web.php` is replaced by the one in this archive (it serves the page at `/`); if your app already has routes, merge the `bus-api` group instead. Start the Routes API and the Assistant API first.

`.env` keys: `ROUTING_API_URL`, `ROUTING_API_KEY`, `ASSISTANT_API_URL`, `BUS_BRAND`, and optionally `BUS_CACHE_TTL`, `BUS_CACHE_STORE`, `MAP_TILE_URL`, `MAP_ATTRIBUTION`.

## What is in the archive

| File | Purpose |
|-|-|
| `app/Services/BusApi.php` | HTTP client for both backends (API key on the Routes API only), network caching, error mapping |
| `app/Services/NetworkBuilder.php` | Compacts stops + routes into what the map needs (pure PHP) |
| `app/Http/Controllers/BusController.php` | Page + JSON endpoints under `/bus-api/*` with validation |
| `app/Exceptions/BusApiException.php` | Upstream errors rendered as `{"message": ...}` |
| `config/busgraphi.php`, `routes/web.php` | Settings and routes |
| `resources/views/busgraphi.blade.php` | The page |
| `public/css/busgraphi.css`, `public/js/busgraphi.js` | Styles and behaviour (no build step) |
| `tests/` | PHPUnit tests (`php artisan test`) and a front-end smoke test (`cd tests/front && npm install && npm test`) |

Endpoints: `GET /bus-api/network`, `POST /bus-api/journey`, `POST /bus-api/chat`, `GET|DELETE /bus-api/chat/{session}`, `GET /bus-api/health`. Chat is rate-limited to 20 requests/minute per client.

## Notes

* The stop/route network is loaded once, cached for 10 minutes (`BUS_CACHE_TTL`) and drawn with Leaflet's canvas renderer, so thousands of stops stay smooth. After changing data in the Routes API, run `php artisan cache:forget busgraphi.network.v1 file`.
* Route lines are straight segments between consecutive stops (the Routes API does not expose road geometry).
* Leaflet, marked and DOMPurify load from CDNs, and the default basemap is OpenStreetMap's public tile server (fine for development; its usage policy does not allow heavy production traffic, so set `MAP_TILE_URL` to your own tile server or a provider with a key). Download the three libraries into `public/` if you need to run offline.
* Stop search in the From/To fields runs in the browser over the already-loaded stops.

## Verification status

PHP files pass `php -l` and `NetworkBuilder` was exercised standalone, but this package was built without access to Packagist, so it was **not booted inside a real Laravel app** and the PHPUnit tests were not run. The front-end smoke test (jsdom, real marked/DOMPurify, stubbed Leaflet) passes all 11 checks.
