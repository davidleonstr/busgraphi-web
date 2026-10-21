<?php

namespace Tests\Feature;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class BusgraphiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'busgraphi.routing_url' => 'http://routes.test',
            'busgraphi.routing_key' => 'secret',
            'busgraphi.assistant_url' => 'http://assistant.test',
            'busgraphi.cache_store' => 'array',
        ]);
    }

    public function test_page_renders_with_both_modes(): void
    {
        $this->get('/')->assertOk()->assertSee('Manual')->assertSee('Assistant')->assertSee('bus-api/network', false);
    }

    public function test_network_sends_the_api_key_and_compacts_the_data(): void
    {
        Http::fake([
            'routes.test/stops*' => Http::response([
                ['id' => 1, 'name' => 'A', 'lat' => 13.7, 'lon' => -89.2],
                ['id' => 2, 'name' => 'B', 'lat' => 13.8, 'lon' => -89.1],
            ]),
            'routes.test/routes/7' => Http::response(['id' => 7, 'code' => '210', 'patterns' => [[
                'id' => 1, 'direction' => 0, 'headsign' => 'S',
                'stops' => [['seq' => 2, 'stop' => ['id' => 2]], ['seq' => 1, 'stop' => ['id' => 1]]],
            ]]]),
            'routes.test/routes' => Http::response([['id' => 7, 'code' => '210', 'is_active' => true]]),
        ]);

        $this->getJson('/bus-api/network')
            ->assertOk()
            ->assertJsonCount(2, 'stops')
            ->assertJsonPath('routes.0.patterns.0.stop_ids', [1, 2]);

        Http::assertSent(fn (Request $r) => str_contains($r->url(), 'routes.test') && $r->header('X-API-Key') === ['secret']);
        Http::assertNotSent(fn (Request $r) => str_contains($r->url(), 'routes.test') && $r->header('X-API-Key') !== ['secret']);
    }

    public function test_chat_goes_to_the_assistant_without_an_api_key(): void
    {
        Http::fake(['assistant.test/chat' => Http::response(['session_id' => 'abc12345', 'reply' => '**Hi**', 'journeys' => [], 'tool_calls' => []])]);

        $this->postJson('/bus-api/chat', ['message' => 'hola', 'location' => ['lat' => 13.7, 'lon' => -89.2]])
            ->assertOk()->assertJsonPath('reply', '**Hi**');

        Http::assertSent(fn (Request $r) => $r->url() === 'http://assistant.test/chat'
            && ! $r->hasHeader('X-API-Key')
            && $r['location']['lat'] === 13.7);
    }

    public function test_journey_requires_exactly_one_origin_form(): void
    {
        $this->postJson('/bus-api/journey', [
            'origin' => ['lat' => 13.7, 'lon' => -89.2], 'origin_stop_id' => 5, 'destination_stop_id' => 9,
        ])->assertStatus(422);

        $this->postJson('/bus-api/journey', ['destination_stop_id' => 9])->assertStatus(422);
    }

    public function test_journey_rejects_coordinates_outside_el_salvador(): void
    {
        $this->postJson('/bus-api/journey', ['origin' => ['lat' => 40.7, 'lon' => -74.0], 'destination_stop_id' => 9])
            ->assertStatus(422);
    }

    public function test_journey_is_forwarded_with_the_key_and_user_facing_errors_pass_through(): void
    {
        Http::fake(['routes.test/journeys/plan' => Http::response(['detail' => 'no connection found'], 404)]);

        $this->postJson('/bus-api/journey', ['origin_stop_id' => 5, 'destination_stop_id' => 9, 'fewer_transfers' => true])
            ->assertStatus(404)->assertJsonPath('message', 'no connection found');

        Http::assertSent(fn (Request $r) => $r->header('X-API-Key') === ['secret']
            && $r['origin_stop_id'] === 5 && $r['board_penalty_s'] === 600);
    }

    public function test_unreachable_backend_gives_a_clean_503(): void
    {
        Http::fake(fn () => throw new ConnectionException('refused'));

        $this->postJson('/bus-api/chat', ['message' => 'hola'])->assertStatus(503)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'Assistant API is unreachable'));
    }
}
