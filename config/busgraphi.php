<?php

return [
    'brand' => env('BUS_BRAND', 'Busgraphi'),

    // Routes API (stops, routes, journey planner). It ALWAYS requires the API key, which is added
    // server-side by Laravel so it never reaches the browser.
    'routing_url' => env('ROUTING_API_URL', 'http://127.0.0.1:8000'),
    'routing_key' => env('ROUTING_API_KEY'),

    // Assistant (AI) API. It does not use an API key.
    'assistant_url' => env('ASSISTANT_API_URL', 'http://127.0.0.1:8100'),

    // The stop/route network is cached so the map loads fast and the Routes API is not hammered.
    'cache_store' => env('BUS_CACHE_STORE', 'file'),
    'cache_ttl' => (int) env('BUS_CACHE_TTL', 600), // seconds

    'timeouts' => [
        'routing' => (int) env('ROUTING_API_TIMEOUT', 30),
        'assistant' => (int) env('ASSISTANT_API_TIMEOUT', 120), // LLM calls can be slow
    ],

    'map' => [
        'center' => [13.75, -88.9],
        'zoom' => 9,
        'tile_url' => env('MAP_TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
        'attribution' => env('MAP_ATTRIBUTION', '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'),
    ],
];
