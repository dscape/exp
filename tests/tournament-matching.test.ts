import assert from 'node:assert/strict';
import test from 'node:test';
import { findTournamentPlayer, isClubTournamentName } from '../src/lib/tournament-matching';

const players = [
  { id: 'pl-afonso', name: 'Afonso Oliveira', fideId: '1972790' },
  { id: 'pl-diogo', name: 'Diogo Borges', fideId: '1980157' },
  { id: 'pl-sofia', name: 'Sofia Valente', fideId: '1953494' },
];

const startList = [
  {
    name: 'Oliveira, Afonso Vieira Soares Da Silva',
    fideId: '1972790',
    club: 'Xadrez Colégio Efanor (Nf)',
  },
  {
    name: 'Fonseca, Maria Francisca Morais Dos San',
    fideId: '1981900',
    club: 'Xadrez Colégio Efanor (Nf)',
  },
  {
    name: 'Teixeira, Mateus Gomes',
    fideId: '1985914',
    club: 'Gd Clã Do Norte (Nf)',
  },
];

test('matches long Chess-Results names to club players through the start list FIDE id', () => {
  assert.equal(
    findTournamentPlayer(players, { name: 'Oliveira, Afonso Vieira Soares Da Silva' }, startList)?.id,
    'pl-afonso',
  );
});

test('matches Chess-Results PGN comma names to the right club player', () => {
  assert.equal(
    findTournamentPlayer(players, { name: 'Valente, Sofia' }, [
      { name: 'Valente, Sofia', fideId: '1953494', club: 'Xadrez Colégio Efanor' },
    ])?.id,
    'pl-sofia',
  );
});

test('marks unassociated Efanor start-list entries as club names for pairings', () => {
  assert.equal(
    isClubTournamentName('Fonseca, Maria Francisca Morais Dos San', startList, players),
    true,
  );
  assert.equal(
    isClubTournamentName('Teixeira, Mateus Gomes', startList, players),
    false,
  );
});
