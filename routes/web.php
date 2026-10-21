<?php

use App\Http\Controllers\BusController;
use Illuminate\Support\Facades\Route;

Route::get('/', [BusController::class, 'index'])->name('bus.home');

Route::prefix('bus-api')->name('bus.')->group(function () {
    Route::middleware('throttle:60,1')->group(function () {
        Route::get('network', [BusController::class, 'network'])->name('network');
        Route::post('journey', [BusController::class, 'plan'])->name('journey');
        Route::get('health', [BusController::class, 'health'])->name('health');
    });

    // LLM calls cost money: stricter limit
    Route::middleware('throttle:20,1')->group(function () {
        Route::post('chat', [BusController::class, 'chat'])->name('chat');
        Route::get('chat/{session}', [BusController::class, 'history'])->where('session', '[A-Za-z0-9_-]{8,64}')->name('chat.history');
        Route::delete('chat/{session}', [BusController::class, 'forget'])->where('session', '[A-Za-z0-9_-]{8,64}')->name('chat.forget');
    });
});
