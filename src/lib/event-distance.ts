import type { EventDocumentRecord } from './types';

export type Coordinates = { lat: number; lon: number };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type DistanceInput = {
  location?: string | null;
  name?: string | null;
  documents?: EventDocumentRecord[] | null;
  explicitDistanceKm?: unknown;
};

type KnownLocation = { aliases: string[]; coordinates: Coordinates; distanceKm?: number };

const DISTANCE_USER_AGENT = 'EscolaXadrezPorto/1.0 distance-estimator';
const GEOCODE_TIMEOUT_MS = 4500;
const ROUTE_TIMEOUT_MS = 4500;

export const DEFAULT_EVENT_DISTANCE_KM = 5;
export const EFANOR_COORDINATES: Coordinates = { lat: 41.185195, lon: -8.652926 };

const KNOWN_PORTUGAL_LOCATIONS: KnownLocation[] = [
  { aliases: ['colegio efanor', 'colégio efanor', 'efanor', 'senhora da hora'], coordinates: EFANOR_COORDINATES, distanceKm: 1 },
  { aliases: ['largo do rossio mangualde', 'mangualde'], coordinates: { lat: 40.6046, lon: -7.7617 }, distanceKm: 150 },
  { aliases: ['matosinhos'], coordinates: { lat: 41.1821, lon: -8.6891 }, distanceKm: 5 },
  { aliases: ['leca da palmeira', 'leça da palmeira'], coordinates: { lat: 41.1910, lon: -8.7069 } },
  { aliases: ['porto'], coordinates: { lat: 41.1496, lon: -8.6109 }, distanceKm: 7 },
  { aliases: ['vila nova de gaia', 'gaia'], coordinates: { lat: 41.1242, lon: -8.6125 } },
  { aliases: ['maia'], coordinates: { lat: 41.2357, lon: -8.6199 } },
  { aliases: ['ermesinde'], coordinates: { lat: 41.2165, lon: -8.5532 } },
  { aliases: ['rio tinto'], coordinates: { lat: 41.1780, lon: -8.5593 }, distanceKm: 10 },
  { aliases: ['gondomar'], coordinates: { lat: 41.1445, lon: -8.5322 } },
  { aliases: ['paredes'], coordinates: { lat: 41.2073, lon: -8.3354 }, distanceKm: 30 },
  { aliases: ['penafiel'], coordinates: { lat: 41.2084, lon: -8.2829 } },
  { aliases: ['espinho'], coordinates: { lat: 41.0076, lon: -8.6413 } },
  { aliases: ['sao joao da madeira', 'são joão da madeira', 'torre da oliva'], coordinates: { lat: 40.9005, lon: -8.4907 }, distanceKm: 45 },
  { aliases: ['pedroucos', 'pedrouços'], coordinates: { lat: 41.1884, lon: -8.5877 }, distanceKm: 7 },
  { aliases: ['aveiro'], coordinates: { lat: 40.6405, lon: -8.6538 } },
  { aliases: ['braga'], coordinates: { lat: 41.5454, lon: -8.4265 } },
  { aliases: ['guimaraes', 'guimarães'], coordinates: { lat: 41.4444, lon: -8.2962 } },
  { aliases: ['vila real'], coordinates: { lat: 41.3006, lon: -7.7441 } },
  { aliases: ['viseu'], coordinates: { lat: 40.6566, lon: -7.9125 } },
  { aliases: ['coimbra'], coordinates: { lat: 40.2033, lon: -8.4103 } },
  { aliases: ['figueira da foz'], coordinates: { lat: 40.1509, lon: -8.8618 } },
  { aliases: ['leiria'], coordinates: { lat: 39.7436, lon: -8.8071 } },
  { aliases: ['pombal'], coordinates: { lat: 39.9167, lon: -8.6285 }, distanceKm: 160 },
  { aliases: ['lisboa', 'lisbon'], coordinates: { lat: 38.7223, lon: -9.1393 } },
];

export async function resolveEventDistanceKm(input: DistanceInput, fetcher: FetchLike = fetch): Promise<number> {
  const explicitDistance = normalizeExplicitDistanceKm(input.explicitDistanceKm);
  if (explicitDistance !== undefined) return explicitDistance;

  return (await calculateEventDistanceKm(input, fetcher)) ?? 0;
}

export async function calculateEventDistanceKm(input: DistanceInput, fetcher: FetchLike = fetch): Promise<number | undefined> {
  const knownLocation = knownLocationForInput(input);
  if (knownLocation?.distanceKm !== undefined) return knownLocation.distanceKm;

  const coordinates =
    coordinatesFromDocuments(input.documents) ??
    knownLocation?.coordinates ??
    (await geocodeEventLocation(input, fetcher));

  if (!coordinates) return undefined;

  const routeDistanceKm = await fetchRouteDistanceKm(EFANOR_COORDINATES, coordinates, fetcher);
  if (routeDistanceKm !== undefined) return roundDistanceKm(routeDistanceKm);
  return knownLocation?.distanceKm ?? roundDistanceKm(estimateDrivingDistanceKm(EFANOR_COORDINATES, coordinates));
}

export function estimateEventDistanceKm(input: Pick<DistanceInput, 'location' | 'name'>): number | undefined {
  const knownLocation = knownLocationForInput(input);
  if (!knownLocation) return undefined;
  return knownLocation.distanceKm ?? roundDistanceKm(estimateDrivingDistanceKm(EFANOR_COORDINATES, knownLocation.coordinates));
}

function normalizeExplicitDistanceKm(value: unknown) {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance <= 0) return undefined;
  if (Math.round(distance) === DEFAULT_EVENT_DISTANCE_KM) return undefined;
  return Math.round(distance);
}

async function geocodeEventLocation(input: DistanceInput, fetcher: FetchLike) {
  const query = eventLocationQuery(input);
  if (!query) return undefined;

  try {
    for (const search of geocodeSearches(query)) {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      if (search.countryCode) url.searchParams.set('countrycodes', search.countryCode);
      url.searchParams.set('q', search.query);

      const response = await fetchWithTimeout(fetcher, url.toString(), GEOCODE_TIMEOUT_MS, {
        accept: 'application/json',
        'user-agent': DISTANCE_USER_AGENT,
      });
      if (!response.ok) continue;

      const results = (await response.json().catch(() => undefined)) as Array<{ lat?: string; lon?: string }> | undefined;
      const first = results?.[0];
      const coordinates = coordinatesFromNumbers(Number(first?.lat), Number(first?.lon));
      if (coordinates) return coordinates;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function fetchRouteDistanceKm(origin: Coordinates, destination: Coordinates, fetcher: FetchLike) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;
    const response = await fetchWithTimeout(fetcher, url, ROUTE_TIMEOUT_MS, {
      accept: 'application/json',
      'user-agent': DISTANCE_USER_AGENT,
    });
    if (!response.ok) return undefined;

    const payload = (await response.json().catch(() => undefined)) as { routes?: Array<{ distance?: number }> } | undefined;
    const meters = payload?.routes?.[0]?.distance;
    return Number.isFinite(meters) && meters !== undefined ? meters / 1000 : undefined;
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(fetcher: FetchLike, url: string, timeoutMs: number, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function coordinatesFromDocuments(documents?: EventDocumentRecord[] | null) {
  for (const document of Array.isArray(documents) ? documents : []) {
    const coordinates = coordinatesFromUrl(document.url);
    if (coordinates) return coordinates;
  }
  return undefined;
}

function coordinatesFromUrl(raw: string) {
  const decoded = decodeURIComponent(raw);
  const urlCoordinates = coordinatesFromUrlSearchParams(decoded);
  if (urlCoordinates) return urlCoordinates;

  return (
    coordinatesFromPattern(decoded, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ??
    coordinatesFromPattern(decoded, /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ??
    coordinatesFromPattern(decoded, /\b(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\b/)
  );
}

function coordinatesFromUrlSearchParams(raw: string) {
  try {
    const url = new URL(raw);
    const coordinateParams = [url.searchParams.get('q'), url.searchParams.get('query'), url.searchParams.get('ll')];
    for (const value of coordinateParams) {
      const coordinates = value ? coordinatesFromPattern(value, /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/) : undefined;
      if (coordinates) return coordinates;
    }
    const mlat = Number(url.searchParams.get('mlat'));
    const mlon = Number(url.searchParams.get('mlon'));
    return coordinatesFromNumbers(mlat, mlon);
  } catch {
    return undefined;
  }
}

function coordinatesFromPattern(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  if (!match) return undefined;
  return coordinatesFromNumbers(Number(match[1]), Number(match[2]));
}

function knownLocationForInput(input: Pick<DistanceInput, 'location' | 'name'>) {
  const text = normalizeSearchText(eventLocationQuery(input) ?? '');
  if (!text) return undefined;

  return KNOWN_PORTUGAL_LOCATIONS.find((place) =>
    place.aliases.some((alias) => containsPlaceAlias(text, normalizeSearchText(alias))),
  );
}

function eventLocationQuery(input: Pick<DistanceInput, 'location' | 'name'>) {
  const location = cleanLocationText(input.location);
  if (location) return location;
  return cleanLocationText(input.name);
}

function cleanLocationText(value?: string | null) {
  const text = String(value ?? '')
    .replace(/\s+[-–—]\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || /^(a definir|por definir|sem local|n\/?a|online)$/i.test(text)) return undefined;
  return text;
}

function geocodeSearches(query: string) {
  const searches = [];
  if (!/\b(portugal|pt)\b/i.test(query)) searches.push({ query: `${query}, Portugal`, countryCode: 'pt' });
  searches.push({ query });
  return searches;
}

function containsPlaceAlias(text: string, alias: string) {
  if (!alias) return false;
  const index = text.indexOf(alias);
  if (index < 0) return false;
  const before = index === 0 ? '' : text[index - 1];
  const after = text[index + alias.length] ?? '';
  return !isSearchChar(before) && !isSearchChar(after);
}

function isSearchChar(value: string) {
  return /[a-z0-9]/.test(value);
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function coordinatesFromNumbers(lat: number, lon: number): Coordinates | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

function estimateDrivingDistanceKm(origin: Coordinates, destination: Coordinates) {
  const straightLineKm = haversineKm(origin, destination);
  const roadFactor = straightLineKm < 8 ? 1.35 : straightLineKm < 30 ? 1.25 : straightLineKm < 90 ? 1.35 : 1.48;
  return straightLineKm * roadFactor;
}

function haversineKm(a: Coordinates, b: Coordinates) {
  const earthRadiusKm = 6371;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function roundDistanceKm(distanceKm: number | undefined) {
  if (distanceKm === undefined || !Number.isFinite(distanceKm) || distanceKm < 0) return undefined;
  if (distanceKm < 1) return 1;
  if (distanceKm < 10) return Math.max(1, Math.round(distanceKm));
  return Math.max(1, Math.round(distanceKm / 5) * 5);
}
