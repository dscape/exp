import type { EventType } from './types';

export type EventTypeFilter = 'all' | EventType;
export type EventStatusFilter = 'all' | 'upcoming' | 'ongoing' | 'completed';

export type EventFilterState = {
  season: string;
  distance: string;
  typeFilter: EventTypeFilter;
  statusFilters: EventStatusFilter[];
  recommendedOnly: boolean;
  myEventsOnly: boolean;
};

export const EVENT_FILTER_SEASONS = ['2025/26', '2026/27'] as const;
const EVENT_FILTER_DISTANCES = ['25', '75', '250', '9999'] as const;
const EVENT_TYPE_FILTERS = ['all', 'standard', 'blitz', 'rapid'] as const;
const EVENT_STATUS_FILTERS = ['all', 'upcoming', 'ongoing', 'completed'] as const;

export const DEFAULT_EVENT_FILTERS: EventFilterState = {
  season: '2025/26',
  distance: '9999',
  typeFilter: 'all',
  statusFilters: ['upcoming', 'ongoing'],
  recommendedOnly: false,
  myEventsOnly: false,
};

export function eventFiltersFromSearch(search: string): EventFilterState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const myEventsOnly = params.get('mine') === '1';
  return {
    season: parseOneOf(params.get('season'), EVENT_FILTER_SEASONS, '2025/26'),
    distance: parseOneOf(params.get('distance'), EVENT_FILTER_DISTANCES, '9999'),
    typeFilter: parseOneOf(params.get('type'), EVENT_TYPE_FILTERS, DEFAULT_EVENT_FILTERS.typeFilter),
    statusFilters: parseStatusFilters(params.get('status')),
    recommendedOnly: !myEventsOnly && params.get('recommended') === '1',
    myEventsOnly,
  };
}

export function eventFiltersToSearch(filters: EventFilterState) {
  const normalized = normalizeEventFilters(filters);
  const params = new URLSearchParams();
  if (normalized.season !== DEFAULT_EVENT_FILTERS.season) params.set('season', normalized.season);
  if (normalized.distance !== DEFAULT_EVENT_FILTERS.distance) params.set('distance', normalized.distance);
  if (normalized.typeFilter !== DEFAULT_EVENT_FILTERS.typeFilter) params.set('type', normalized.typeFilter);
  if (!sameStatusFilters(normalized.statusFilters, DEFAULT_EVENT_FILTERS.statusFilters)) params.set('status', normalized.statusFilters.join(','));
  if (normalized.recommendedOnly) params.set('recommended', '1');
  if (normalized.myEventsOnly) params.set('mine', '1');
  return params.toString();
}

export function eventsRouteForFilters(filters: EventFilterState) {
  const query = eventFiltersToSearch(filters);
  return query ? `/eventos?${query}` : '/eventos';
}

export function appendEventFilterSearch(path: string, filters: EventFilterState) {
  const query = eventFiltersToSearch(filters);
  return query ? `${path}?${query}` : path;
}

function normalizeEventFilters(filters: EventFilterState): EventFilterState {
  const myEventsOnly = Boolean(filters.myEventsOnly);
  return {
    season: parseOneOf(filters.season, EVENT_FILTER_SEASONS, '2025/26'),
    distance: parseOneOf(filters.distance, EVENT_FILTER_DISTANCES, '9999'),
    typeFilter: parseOneOf(filters.typeFilter, EVENT_TYPE_FILTERS, DEFAULT_EVENT_FILTERS.typeFilter),
    statusFilters: normalizeStatusFilters(filters.statusFilters),
    recommendedOnly: !myEventsOnly && Boolean(filters.recommendedOnly),
    myEventsOnly,
  };
}

function sameStatusFilters(a: EventStatusFilter[], b: EventStatusFilter[]) {
  return a.length === b.length && a.every((status, index) => status === b[index]);
}

function parseStatusFilters(value: string | null) {
  if (!value) return [...DEFAULT_EVENT_FILTERS.statusFilters];
  return normalizeStatusFilters(value.split(','));
}

function normalizeStatusFilters(values: readonly string[]) {
  const requested = new Set(values.filter(isStatusFilter));
  if (!requested.size) return [...DEFAULT_EVENT_FILTERS.statusFilters];
  if (requested.has('all')) return ['all'] satisfies EventStatusFilter[];
  const statuses = EVENT_STATUS_FILTERS.filter((status) => status !== 'all' && requested.has(status));
  return statuses.length ? statuses : [...DEFAULT_EVENT_FILTERS.statusFilters];
}

function parseOneOf<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : fallback;
}

function isStatusFilter(value: string): value is EventStatusFilter {
  return (EVENT_STATUS_FILTERS as readonly string[]).includes(value);
}
