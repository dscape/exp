import assert from 'node:assert/strict';
import test from 'node:test';
import { individualMedalCandidates } from '../src/lib/medals';

test('awards category podiums as gold, silver and bronze medals', () => {
  const candidates = individualMedalCandidates([
    { position: 1, playerId: 'p1', category: 'U12' },
    { position: 2, playerId: 'p2', category: 'U12' },
    { position: 3, playerId: 'p3', category: 'U12' },
  ]).filter((candidate) => candidate.competition === 'category');

  assert.deepEqual(
    candidates.map(({ playerId, type, place, label }) => ({ playerId, type, place, label })),
    [
      { playerId: 'p1', type: 'gold', place: 1, label: '1.º Sub-12' },
      { playerId: 'p2', type: 'silver', place: 2, label: '2.º Sub-12' },
      { playerId: 'p3', type: 'bronze', place: 3, label: '3.º Sub-12' },
    ],
  );
});

test('keeps external players in category podium order', () => {
  const candidates = individualMedalCandidates([
    { position: 1, category: 'U12' },
    { position: 2, playerId: 'p2', category: 'U12' },
    { position: 3, playerId: 'p3', category: 'U12' },
  ]).filter((candidate) => candidate.competition === 'category');

  assert.deepEqual(
    candidates.map(({ playerId, type, place, label }) => ({ playerId, type, place, label })),
    [
      { playerId: 'p2', type: 'silver', place: 2, label: '2.º Sub-12' },
      { playerId: 'p3', type: 'bronze', place: 3, label: '3.º Sub-12' },
    ],
  );
});

test('allows one player to receive overall and female podium medals in one event', () => {
  const candidates = individualMedalCandidates([
    { position: 1, playerId: 'p1', category: 'U14' },
    { position: 2, playerId: 'p2', category: 'U14' },
    { position: 3, playerId: 'p3', category: 'U14', sex: 'w' },
  ]);

  assert.deepEqual(
    candidates
      .filter((candidate) => candidate.playerId === 'p3')
      .map(({ type, competition, place, label }) => ({ type, competition, place, label })),
    [
      { type: 'bronze', competition: 'overall', place: 3, label: undefined },
      { type: 'bronze', competition: 'category', place: 3, label: '3.º Sub-14' },
      { type: 'gold', competition: 'female', place: 1, label: '1.ª feminina' },
    ],
  );
});
