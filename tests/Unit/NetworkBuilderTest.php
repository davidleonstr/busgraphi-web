<?php

namespace Tests\Unit;

use App\Services\NetworkBuilder;
use PHPUnit\Framework\TestCase;

class NetworkBuilderTest extends TestCase
{
    public function test_orders_pattern_stops_by_seq_and_drops_unknown_stops(): void
    {
        $stops = [
            ['id' => 1, 'name' => 'A', 'lat' => 13.7, 'lon' => -89.2, 'municipality' => 'X', 'tags' => ['big' => 'ignored']],
            ['id' => 2, 'name' => 'B', 'lat' => 13.8, 'lon' => -89.1],
            ['id' => 3, 'name' => 'C', 'lat' => 13.9, 'lon' => -89.0],
        ];
        $routes = [[
            'id' => 7, 'code' => '210', 'colour' => '1F6FEB', 'is_active' => true,
            'patterns' => [[
                'id' => 1, 'direction' => 0, 'headsign' => 'S',
                'stops' => [
                    ['seq' => 3, 'stop' => ['id' => 3]],
                    ['seq' => 1, 'stop' => ['id' => 1]],
                    ['seq' => 2, 'stop' => ['id' => 999]], // not in the stop list
                ],
            ]],
        ]];

        $net = NetworkBuilder::compact($stops, $routes);

        $this->assertCount(3, $net['stops']);
        $this->assertArrayNotHasKey('tags', $net['stops'][0]);
        $this->assertSame([1, 3], $net['routes'][0]['patterns'][0]['stop_ids']);
        $this->assertSame('#1f6feb', $net['routes'][0]['colour']);
    }

    public function test_skips_inactive_routes_and_single_stop_patterns_and_sorts_by_code(): void
    {
        $stops = [['id' => 1, 'lat' => 13.7, 'lon' => -89.2], ['id' => 2, 'lat' => 13.8, 'lon' => -89.1]];
        $mk = fn ($id, $code, $active = true, $n = 2) => [
            'id' => $id, 'code' => $code, 'is_active' => $active,
            'patterns' => [['id' => $id, 'stops' => array_map(fn ($i) => ['seq' => $i, 'stop' => ['id' => $i]], range(1, $n))]],
        ];

        $net = NetworkBuilder::compact($stops, [$mk(1, '44'), $mk(2, '5'), $mk(3, '9', false), $mk(4, '7', true, 1)]);

        $this->assertSame(['5', '44'], array_column($net['routes'], 'code'));
    }
}
