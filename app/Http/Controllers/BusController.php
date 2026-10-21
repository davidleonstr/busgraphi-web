<?php

namespace App\Http\Controllers;

use App\Services\BusApi;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusController extends Controller
{
    public function __construct(private readonly BusApi $api)
    {
    }

    public function index()
    {
        return view('busgraphi', [
            'brand' => config('busgraphi.brand'),
            'cfg' => [
                'map' => config('busgraphi.map'),
                'endpoints' => [
                    'network' => route('bus.network'),
                    'journey' => route('bus.journey'),
                    'health' => route('bus.health'),
                    'chat' => route('bus.chat'),
                ],
            ],
        ]);
    }

    public function network(): JsonResponse
    {
        return response()->json($this->api->network());
    }

    public function plan(Request $request): JsonResponse
    {
        $rules = ['max_walk_m' => 'nullable|integer|min:50|max:3000', 'fewer_transfers' => 'nullable|boolean'];
        foreach (['origin', 'destination'] as $k) {
            $rules[$k] = "required_without:{$k}_stop_id|prohibits:{$k}_stop_id|array";
            // same bounding box as the Routes API (El Salvador with a small margin)
            $rules["$k.lat"] = "required_with:$k|numeric|between:12.9,14.6";
            $rules["$k.lon"] = "required_with:$k|numeric|between:-90.3,-87.5";
            $rules["{$k}_stop_id"] = "required_without:$k|prohibits:$k|integer|min:1";
        }
        $d = $request->validate($rules);

        $payload = [
            'max_walk_m' => (int) ($d['max_walk_m'] ?? 800),
            'board_penalty_s' => ! empty($d['fewer_transfers']) ? 600 : 120,
        ];
        foreach (['origin', 'destination'] as $k) {
            if (isset($d["{$k}_stop_id"])) {
                $payload["{$k}_stop_id"] = (int) $d["{$k}_stop_id"];
            } else {
                $payload[$k] = ['lat' => (float) $d[$k]['lat'], 'lon' => (float) $d[$k]['lon']];
            }
        }

        return response()->json($this->api->plan($payload));
    }

    public function chat(Request $request): JsonResponse
    {
        $d = $request->validate([
            'message' => 'required|string|max:2000',
            'session_id' => 'nullable|string|max:64',
            'location' => 'nullable|array',
            'location.lat' => 'required_with:location|numeric|between:-90,90',
            'location.lon' => 'required_with:location|numeric|between:-180,180',
        ]);

        $payload = ['message' => $d['message']];
        if (! empty($d['session_id'])) {
            $payload['session_id'] = $d['session_id'];
        }
        if (! empty($d['location'])) {
            $payload['location'] = ['lat' => (float) $d['location']['lat'], 'lon' => (float) $d['location']['lon']];
        }

        return response()->json($this->api->chat($payload));
    }

    public function history(string $session): JsonResponse
    {
        return response()->json($this->api->chatHistory($session));
    }

    public function forget(string $session): JsonResponse
    {
        $this->api->chatForget($session);

        return response()->json(['ok' => true]);
    }

    public function health(): JsonResponse
    {
        return response()->json($this->api->health());
    }
}
