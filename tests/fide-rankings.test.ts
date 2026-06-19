import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFideRankingRows, combinedRating, previousCalendarMonth } from '../src/lib/fide-rankings';
import { players } from '../src/lib/seed-data';
import type { Player } from '../src/lib/types';

test('rating deltas use the previous calendar month for current seed data', () => {
  const month = latestFideMonth(players);
  assert.equal(month, '2026-06-01');
  assert.equal(previousCalendarMonth(month), '2026-05-01');

  const rows = buildFideRankingRows(players, month, 'combined');
  const jose = findRow(rows, 'José Veiga');
  const may = ratingPoint(jose, '2026-05-01');
  assert.equal(jose.deltaStandard, jose.standard - may.standard!);
  assert.equal(jose.deltaRapid, jose.rapid - may.rapid!);
  assert.equal(jose.deltaBlitz, jose.blitz - may.blitz!);
  assert.equal(jose.deltaCombined, jose.combined - combinedRating(may.standard!, may.rapid!, may.blitz!));
});

test('rank trends are absolute or category-relative depending on grouping', () => {
  const month = latestFideMonth(players);
  const rows = buildFideRankingRows(players, month, 'combined');
  const tomas = findRow(rows, 'Tomás Almeida');

  assert.equal(tomas.rank, 13);
  assert.equal(tomas.rankDelta, 2);
  assert.equal(tomas.groupRank, 1);
  assert.equal(tomas.groupRankDelta, 0);
});

test('combined trend changes when a new rating type enters the calculation', () => {
  const month = latestFideMonth(players);
  const rows = buildFideRankingRows(players, month, 'combined');
  const benjamin = findRow(rows, 'Benjamin Job');

  assert.equal(benjamin.rapid, 1695);
  assert.equal(benjamin.deltaRapid, undefined);
  assert.equal(benjamin.deltaCombined, 124);
});

function latestFideMonth(input: Player[]) {
  return [...new Set(input.flatMap((player) => player.ratingHistory?.map((point) => point.listMonth) ?? []))].sort().at(-1);
}

function findRow(rows: ReturnType<typeof buildFideRankingRows>, name: string) {
  const row = rows.find((candidate) => candidate.name === name);
  assert.ok(row, `${name} row should exist`);
  return row;
}

function ratingPoint(player: Player, month: string) {
  const point = player.ratingHistory?.find((candidate) => candidate.listMonth === month);
  assert.ok(point, `${player.name} should have ${month} history`);
  return point;
}
