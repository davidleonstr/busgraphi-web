<?php

namespace App\Services;

use App\Exceptions\BusApiException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/** Server-side client for the two backends. The browser only ever talks to Laravel. */
class BusApi
{
    private const PAGE = 1000;       // the Routes API caps /stops at 1000 rows per call
    private const MAX_PAGES = 40;
    private const POOL_CHUNK = 15;   // parallel requests when loading route details

    // ------------------------------------------------------------------ Routes API (always with API key)

    private function routingBase(): string
    {
        return rtrim((string) config('busgraphi.routing_url'), '/');
    }

    private function routingHeaders(): array
    {
        $key = config('busgraphi.routing_key');

        return $key ? ['X-API-Key' => $key] : [];
    }

    private function routing(): PendingRequest
    {
        return Http::baseUrl($this->routingBase())
            ->withHeaders($this->routingHeaders())
            ->acceptJson()
            ->timeout((int) config('busgraphi.timeouts.routing'));
    }

    /** Whole network (stops + routes with ordered stop ids), cached. */
    public function network(): array
    {
        $store = Cache::store(config('busgraphi.cache_store'));

        return $store->remember('busgraphi.network.v1', (int) config('busgraphi.cache_ttl'), function () {
            return NetworkBuilder::compact($this->allStops(), $this->routeDetails());
        });
    }

    public function forgetNetwork(): void
    {
        Cache::store(config('busgraphi.cache_store'))->forget('busgraphi.network.v1');
    }

    private function allStops(): array
    {
        $all = [];
        for ($page = 0; $page < self::MAX_PAGES; $page++) {
            $rows = $this->send(
                fn () => $this->routing()->get('/stops', ['limit' => self::PAGE, 'offset' => $page * self::PAGE]),
                'Routes API'
            )->json() ?? [];
            $all = array_merge($all, $rows);
            if (count($rows) < self::PAGE) {
                break;
            }
        }

        return $all;
    }

    private function routeDetails(): array
    {
        $list = $this->send(fn () => $this->routing()->get('/routes'), 'Routes API')->json() ?? [];
        $list = array_values(array_filter($list, fn ($r) => ($r['is_active'] ?? true) !== false));

        $details = [];
        foreach (array_chunk($list, self::POOL_CHUNK) as $chunk) {
            $base = $this->routingBase();
            $headers = $this->routingHeaders();
            $timeout = (int) config('busgraphi.timeouts.routing');

            $responses = Http::pool(fn (Pool $pool) => array_map(
                fn ($r) => $pool->baseUrl($base)->withHeaders($headers)->acceptJson()->timeout($timeout)
                    ->get('/routes/'.(int) $r['id']),
                $chunk
            ));

            foreach ($responses as $res) {
                // a failed/slow single route must not break the whole map
                if ($res instanceof Response && $res->successful() && is_array($res->json())) {
                    $details[] = $res->json();
                }
            }
        }

        return $details;
    }

    public function plan(array $payload): array
    {
        return $this->send(fn () => $this->routing()->asJson()->post('/journeys/plan', $payload), 'Routes API')->json();
    }

    // ------------------------------------------------------------------ Assistant API (no API key)

    private function assistant(): PendingRequest
    {
        return Http::baseUrl(rtrim((string) config('busgraphi.assistant_url'), '/'))
            ->acceptJson()
            ->timeout((int) config('busgraphi.timeouts.assistant'));
    }

    public function chat(array $payload): array
    {
        return $this->send(fn () => $this->assistant()->asJson()->post('/chat', $payload), 'Assistant API')->json();
    }

    public function chatHistory(string $session): array
    {
        return $this->send(fn () => $this->assistant()->get('/sessions/'.$session), 'Assistant API')->json();
    }

    public function chatForget(string $session): void
    {
        try {
            $this->assistant()->delete('/sessions/'.$session);
        } catch (ConnectionException) {
            // nothing to clean up if the assistant is down
        }
    }

    // ------------------------------------------------------------------ health

    public function health(): array
    {
        return [
            'routes' => $this->alive(fn () => $this->routing()->timeout(4)->get('/stops', ['limit' => 1])),
            'assistant' => $this->alive(fn () => $this->assistant()->timeout(4)->get('/health')),
        ];
    }

    private function alive(callable $call): bool
    {
        try {
            return $call()->successful();
        } catch (\Throwable) {
            return false;
        }
    }

    // ------------------------------------------------------------------ plumbing

    private function send(callable $call, string $service): Response
    {
        try {
            $res = $call();
        } catch (ConnectionException) {
            throw new BusApiException(503, "$service is unreachable. Check that it is running and the URL in .env is correct.");
        }

        if ($res->successful()) {
            return $res;
        }

        $status = $res->status();
        if ($status === 401 || $status === 403) {
            throw new BusApiException(502, "$service rejected the credentials (check ROUTING_API_KEY).");
        }
        if ($status >= 500) {
            throw new BusApiException($status === 503 ? 503 : 502, "$service is having problems (HTTP $status). Try again shortly.");
        }

        // 404 "no connection found", 422 validation, 429 rate limit... are meaningful to the user
        throw new BusApiException($status, $this->detail($res));
    }

    private function detail(Response $res): string
    {
        $d = $res->json('detail');
        if (is_array($d)) {
            $d = collect($d)->map(fn ($e) => is_array($e) ? ($e['msg'] ?? json_encode($e)) : (string) $e)->implode('; ');
        }

        return (string) ($d ?: ($res->json('message') ?: 'Upstream error (HTTP '.$res->status().')'));
    }
}
