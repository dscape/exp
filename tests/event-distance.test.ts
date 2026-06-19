import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEventDistanceKm, resolveEventDistanceKm } from '../src/lib/event-distance';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

test('calculates road distance from Colégio Efanor when geocoding and routing are available', async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://nominatim.openstreetmap.org/')) {
      return jsonResponse([{ lat: '40.5693853', lon: '-7.7578776' }]);
    }
    if (url.startsWith('https://router.project-osrm.org/')) {
      return jsonResponse({ routes: [{ distance: 150_633.5 }] });
    }
    return new Response('', { status: 404 });
  };

  const distance = await calculateEventDistanceKm({ location: 'Centro de Congressos Inventado' }, fetcher);

  assert.equal(distance, 150);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /Centro\+de\+Congressos\+Inventado%2C\+Portugal/);
});

test('falls back to global geocoding when a location is outside Portugal', async () => {
  const fetcher = async (url: string) => {
    if (url.includes('countrycodes=pt')) return jsonResponse([]);
    if (url.startsWith('https://nominatim.openstreetmap.org/')) {
      return jsonResponse([{ lat: '51.4936381', lon: '-0.2350354' }]);
    }
    if (url.startsWith('https://router.project-osrm.org/')) {
      return jsonResponse({ routes: [{ distance: 1_929_377 }] });
    }
    return new Response('', { status: 404 });
  };

  const distance = await calculateEventDistanceKm({ location: 'London Mindsports Centre, 21 Dalling Rd, London W6 0JD' }, fetcher);

  assert.equal(distance, 1930);
});

test('falls back to the local Portugal gazetteer when external distance services fail', async () => {
  const fetcher = async () => new Response('', { status: 503 });

  const distance = await calculateEventDistanceKm({ location: 'Largo do Rossio - Mangualde' }, fetcher);

  assert.equal(distance, 150);
});

test('does not keep the old default 5 km distance when no location can be resolved', async () => {
  const fetcher = async () => new Response('', { status: 404 });

  assert.equal(await resolveEventDistanceKm({ location: 'A definir', explicitDistanceKm: 5 }, fetcher), 0);
  assert.equal(await resolveEventDistanceKm({ location: 'A definir', explicitDistanceKm: 42 }, fetcher), 42);
});
