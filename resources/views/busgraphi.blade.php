<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>{{ $brand }} · Public transport planner</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <link rel="stylesheet" href="{{ asset('css/busgraphi.css') }}">
</head>
<body data-mode="manual">

<header class="topbar">
    <div class="brand">
        <div class="brand-text"><strong>{{ $brand }}</strong><span>Public transport · El Salvador</span></div>
    </div>

    <div class="mode-switch" role="tablist" aria-label="Interaction mode">
        <span class="thumb" aria-hidden="true"></span>
        <button type="button" role="tab" data-mode="manual" aria-selected="true">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
            <span><b>Manual</b><small>Pick stops on the map</small></span>
        </button>
        <button type="button" role="tab" data-mode="assistant" aria-selected="false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <span><b>Assistant</b><small>Ask in the chat</small></span>
        </button>
    </div>

    <!--
    1 Reyes 8:56: Celebra que Dios ha cumplido las promesas hechas a Israel a través de Moisés.
    Salmo 135:3-4: Destaca que el Señor escogió a Jacob y a Israel como un tesoro especial.
    Salmo 72:18-19: Alaba al Señor, Dios de Israel, reconociendo sus maravillas y su gloria en la tierra.
    Lucas 1:68 (Benedictus): Exalta al Dios de Israel por visitar y redimir a su pueblo.
    ⠀⠀⠀⡜⡄⠀⠀⠀
    ⢖⢒⡞⠒⢳⡒⡲⠀
    ⢀⣟⠀⠀⠀⣻⡀⠀
    ⠮⠬⢦⠤⡴⠥⠵⠀
    ⠀⠀⠀⠱⠁⠀⠀
    -->

    <!-- Activate this if you want to know the API's status and go to the script to activate the `health` async function. Escrito por un humano, por cierto
    <div class="status" aria-label="Service status">
        <span class="pill" id="status-routes" title="Routes API"><i></i>Routes</span>
        <span class="pill" id="status-assistant" title="Assistant API"><i></i>Assistant</span>
    </div>
    -->
</header>

<div class="layout">
    <aside class="panel" id="panel">
        <div class="panel-head">
            <span class="mode-tag" id="mode-tag">Manual mode</span>
            <h1 id="panel-title">Plan a trip</h1>
            <p id="panel-sub">Choose a start and a destination on the map or by searching, then calculate the route.</p>
        </div>

        {{-- ======================= MANUAL ======================= --}}
        <section class="view" id="view-manual">
            <div class="tabs" role="tablist">
                <button type="button" class="on" data-tab="plan" role="tab" aria-selected="true">Trip planner</button>
                <button type="button" data-tab="routes" role="tab" aria-selected="false">Routes <span class="count" id="routes-count"></span></button>
            </div>

            <div class="tab" id="tab-plan">
                <form id="plan-form" autocomplete="off">
                    <div class="field" data-field="from">
                        <label for="from-input">From</label>
                        <div class="combo">
                            <span class="pin pin-a">A</span>
                            <input id="from-input" type="text" placeholder="Search a stop, or click the map" aria-autocomplete="list">
                            <button type="button" class="icon-btn clear" aria-label="Clear origin" hidden>&times;</button>
                            <ul class="suggest" hidden></ul>
                        </div>
                    </div>
                    <button type="button" id="swap" class="swap" aria-label="Swap origin and destination" title="Swap">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v16m0 0-3-3m3 3 3-3M16 20V4m0 0-3 3m3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <div class="field" data-field="to">
                        <label for="to-input">To</label>
                        <div class="combo">
                            <span class="pin pin-b">B</span>
                            <input id="to-input" type="text" placeholder="Search a stop, or click the map" aria-autocomplete="list">
                            <button type="button" class="icon-btn clear" aria-label="Clear destination" hidden>&times;</button>
                            <ul class="suggest" hidden></ul>
                        </div>
                    </div>

                    <div class="opts">
                        <label class="range">
                            <span>Max. walking distance <output id="walk-out">800 m</output></span>
                            <input type="range" id="walk" min="200" max="2000" step="100" value="800">
                        </label>
                        <label class="check"><input type="checkbox" id="fewer"><span>Prefer fewer transfers</span></label>
                    </div>

                    <div class="actions">
                        <button type="submit" class="btn primary" id="plan-btn" disabled>Plan trip</button>
                        <button type="button" class="btn" id="reset-btn">Reset</button>
                    </div>
                </form>
                <div id="plan-result" aria-live="polite"></div>
            </div>

            <div class="tab" id="tab-routes" hidden>
                <input type="search" id="route-filter" class="filter" placeholder="Filter routes, e.g. 210" aria-label="Filter routes">
                <ul class="route-list" id="route-list"></ul>
                <div id="route-detail"></div>
            </div>
        </section>

        {{-- ======================= ASSISTANT ======================= --}}
        <section class="view" id="view-assistant" hidden>
            <div class="chat-tools">
                <button type="button" class="chip-btn" id="chat-location" aria-pressed="false">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                    <span>Share my location</span>
                </button>
                <button type="button" class="chip-btn" id="chat-new">New conversation</button>
            </div>

            <div class="chat-log" id="chat-log" aria-live="polite" aria-label="Conversation"></div>

            <div class="chat-suggest" id="chat-suggest"></div>

            <form class="composer" id="chat-form">
                <textarea id="chat-input" rows="1" placeholder="Where do you want to go? (Enter to send)" aria-label="Message"></textarea>
                <button type="submit" class="send" id="chat-send" aria-label="Send">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-4 16-4-6-8-2Z" fill="currentColor"/></svg>
                </button>
            </form>
        </section>
    </aside>

    <main class="map-wrap">
        <div id="map" role="region" aria-label="Map"></div>

        <div class="map-ribbon" id="map-ribbon"></div>

        <div class="layer-box" id="layer-box">
            <label class="check"><input type="checkbox" id="layer-stops" checked><span>Bus stops <em id="stops-count"></em></span></label>
            <label class="check"><input type="checkbox" id="layer-routes" checked><span>Bus routes <em id="lines-count"></em></span></label>
        </div>

        <div class="legend" aria-label="Legend">
            <div><i class="lg-stop"></i>Bus stop</div>
            <div><i class="lg-route"></i>Bus route</div>
            <div><i class="lg-trip"></i>Planned trip</div>
            <div><i class="lg-walk"></i>Walking</div>
        </div>

        <div class="map-overlay" id="map-loading"><div class="spinner"></div><span>Loading stops and routes…</span></div>
        <div class="map-overlay error" id="map-error" hidden>
            <strong>The map data could not be loaded.</strong>
            <span id="map-error-msg"></span>
            <button type="button" class="btn primary" id="map-retry">Try again</button>
        </div>
    </main>
</div>

<script>
    window.BUSGRAPHI = @json($cfg, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG);
</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></script>
<script src="{{ asset('js/busgraphi.js') }}"></script>
</body>
</html>
