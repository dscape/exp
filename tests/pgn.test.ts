import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPgnDatabase, parsePgnGames } from '../src/lib/pgn';

test('parses uploaded PGN games with headers and moves', () => {
  const games = parsePgnGames(`
[Event "Torneio Real"]
[Date "2026.06.01"]
[White "Sofia Valente"]
[Black "Maria Silva"]
[Result "1-0"]
[ECO "D37"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 1-0
`);

  assert.equal(games.length, 1);
  assert.equal(games[0].white, 'Sofia Valente');
  assert.equal(games[0].event, 'Torneio Real');
  assert.equal(games[0].playedOn, '2026-06-01');
  assert.deepEqual(games[0].moves.slice(0, 6), ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6']);
});

test('builds one downloadable PGN database from all real games', () => {
  const pgn = buildPgnDatabase([
    {
      id: 'g1',
      white: 'José Veiga',
      black: 'A. Almeida',
      event: 'Evento Real',
      result: '1-0',
      eco: 'B90',
      moves: ['e4', 'c5', 'Nf3', 'd6'],
      annotations: {},
    },
    {
      id: 'g2',
      white: 'Sofia Valente',
      black: 'Maria Silva',
      event: 'Evento Real',
      result: '1/2-1/2',
      eco: 'D37',
      moves: ['d4', 'd5'],
      annotations: {},
    },
  ]);

  assert.match(pgn, /\[White "José Veiga"\]/);
  assert.match(pgn, /\[White "Sofia Valente"\]/);
  assert.match(pgn, /1\. e4 c5 2\. Nf3 d6 1-0/);
});
