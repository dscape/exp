import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_EVENT_FILTERS,
  appendEventFilterSearch,
  eventFiltersFromSearch,
  eventFiltersToSearch,
  eventsRouteForFilters,
  type EventFilterState,
} from '../src/lib/event-filters';

test('serializes non-default event filters into a stable list URL', () => {
  const filters: EventFilterState = {
    ...DEFAULT_EVENT_FILTERS,
    season: '2026/27',
    distance: '75',
    typeFilter: 'rapid',
    statusFilters: ['completed'],
  };

  assert.equal(
    eventFiltersToSearch(filters),
    'season=2026%2F27&distance=75&type=rapid&status=completed',
  );
  assert.equal(
    eventsRouteForFilters(filters),
    '/eventos?season=2026%2F27&distance=75&type=rapid&status=completed',
  );
  assert.equal(
    appendEventFilterSearch('/eventos/event-1/example', filters),
    '/eventos/event-1/example?season=2026%2F27&distance=75&type=rapid&status=completed',
  );
});

test('parses event filter URLs and keeps mine/recommended mutually exclusive', () => {
  assert.deepEqual(
    eventFiltersFromSearch('season=2026%2F27&type=blitz&status=all&recommended=1&mine=1'),
    {
      ...DEFAULT_EVENT_FILTERS,
      season: '2026/27',
      typeFilter: 'blitz',
      statusFilters: ['all'],
      recommendedOnly: false,
      myEventsOnly: true,
    },
  );
});
