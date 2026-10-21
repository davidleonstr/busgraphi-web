<?php

namespace App\Services;

/**
 * Turns raw Routes-API payloads into the compact structure the map needs.
 * Pure PHP (no framework calls) so it is trivial to unit-test.
 */
class NetworkBuilder
{
    /**
     * @param  array<int,array>  $stops   rows from GET /stops
     * @param  array<int,array>  $routes  rows from GET /routes/{id} (with patterns -> stops)
     */
    public static function compact(array $stops, array $routes): array
    {
        $outStops = [];
        $known = [];
        foreach ($stops as $s) {
            if (! isset($s['id'], $s['lat'], $s['lon'])) {
                continue;
            }
            $known[$s['id']] = true;
            $outStops[] = [
                'id' => (int) $s['id'],
                'name' => (string) ($s['name'] ?? 'Stop '.$s['id']),
                'lat' => round((float) $s['lat'], 6),
                'lon' => round((float) $s['lon'], 6),
                'municipality' => $s['municipality'] ?? null,
            ];
        }

        $outRoutes = [];
        foreach ($routes as $r) {
            if (empty($r['id']) || ($r['is_active'] ?? true) === false) {
                continue;
            }
            $patterns = [];
            foreach ($r['patterns'] ?? [] as $p) {
                $items = $p['stops'] ?? [];
                usort($items, fn ($a, $b) => ($a['seq'] ?? 0) <=> ($b['seq'] ?? 0));
                $ids = [];
                foreach ($items as $it) {
                    $id = $it['stop']['id'] ?? null;
                    if ($id !== null && isset($known[$id])) {
                        $ids[] = (int) $id;
                    }
                }
                if (count($ids) >= 2) {
                    $patterns[] = [
                        'id' => (int) $p['id'],
                        'direction' => (int) ($p['direction'] ?? 0),
                        'headsign' => $p['headsign'] ?? null,
                        'stop_ids' => $ids,
                    ];
                }
            }
            if ($patterns) {
                $outRoutes[] = [
                    'id' => (int) $r['id'],
                    'code' => (string) $r['code'],
                    'name' => $r['name'] ?? null,
                    'operator' => $r['operator'] ?? '',
                    'colour' => self::hex($r['colour'] ?? null),
                    'headway_min' => $r['headway_min'] ?? null,
                    'patterns' => $patterns,
                ];
            }
        }

        usort($outRoutes, fn ($a, $b) => strnatcasecmp($a['code'], $b['code']));

        return ['stops' => $outStops, 'routes' => $outRoutes];
    }

    private static function hex(?string $c): ?string
    {
        if ($c === null) {
            return null;
        }
        $c = ltrim(trim($c), '#');

        return preg_match('/^[0-9a-fA-F]{6}$/', $c) ? '#'.strtolower($c) : null;
    }
}
