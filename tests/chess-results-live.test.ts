import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePairingRows, parseStandingRows } from '../src/lib/chess-results-live';

test('parses comma-form Chess-Results pairing rows with category/rating cells', () => {
  const html = `
    <table>
      <tr>
        <td>1</td><td>Marques, Benedita Maria Correia Cardoso</td><td>U10</td><td>POR</td><td>1405</td><td>0</td><td>0 - 1</td><td>0</td><td>Borges, Diogo Pedro De Almeida Pina Me</td><td>U14</td><td>POR</td><td>1795</td>
      </tr>
      <tr>
        <td>2</td><td>Beijoco, Bernardo Ramos Cabanelas</td><td>U12</td><td>POR</td><td>1713</td><td>0</td><td>1 - 0</td><td>0</td><td>Alves, Tomás Maria De Sousa E Silva A</td><td>U12</td><td>POR</td><td>0</td>
      </tr>
    </table>
  `;

  assert.deepEqual(parsePairingRows(html), [
    {
      board: 1,
      white: 'Marques, Benedita Maria Correia Cardoso',
      black: 'Borges, Diogo Pedro De Almeida Pina Me',
      result: '0-1',
      raw: ['1', 'Marques, Benedita Maria Correia Cardoso', 'U10', 'POR', '1405', '0', '0 - 1', '0', 'Borges, Diogo Pedro De Almeida Pina Me', 'U14', 'POR', '1795'],
    },
    {
      board: 2,
      white: 'Beijoco, Bernardo Ramos Cabanelas',
      black: 'Alves, Tomás Maria De Sousa E Silva A',
      result: '1-0',
      raw: ['2', 'Beijoco, Bernardo Ramos Cabanelas', 'U12', 'POR', '1713', '0', '1 - 0', '0', 'Alves, Tomás Maria De Sousa E Silva A', 'U12', 'POR', '0'],
    },
  ]);
});

test('uses the latest single-round pairing table when Chess-Results includes all rounds', () => {
  const allRounds = Array.from(
    { length: 41 },
    (_, index) =>
      `<tr><td>${index + 1}</td><td>Older White ${index + 1}</td><td>1 - 0</td><td>Older Black ${index + 1}</td></tr>`,
  ).join('');
  const html = `
    <table>${allRounds}</table>
    <table>
      <tr><td>1</td><td>Current White</td><td>1 - 0</td><td>Current Black</td></tr>
    </table>
  `;

  assert.deepEqual(parsePairingRows(html), [
    {
      board: 1,
      white: 'Current White',
      black: 'Current Black',
      result: '1-0',
      raw: ['1', 'Current White', '1 - 0', 'Current Black'],
    },
  ]);
});

test('parses nested Chess-Results standings without shifting player columns', () => {
  const html = `
    <table>
      <tr>
        <td>
          Wrapper text Search for player Procurar
          <table>
            <tr><th>Rk.</th><th>Nº.Inic.</th><th></th><th>Nome</th><th>Tipo</th><th>sexo</th><th>FED</th><th>EloI</th><th>Clube/Cidade</th><th>Pts.</th><th>Desp1</th></tr>
            <tr><td>1</td><td>3</td><td>FM</td><td>Gustavo Martins Santos, Ribeiro</td><td>U20</td><td></td><td>POR</td><td>2216</td><td>Ax Gaia</td><td>7</td><td>39</td></tr>
            <tr><td>2</td><td>5</td><td>NM</td><td>Ricardo Pedro Cruz, Dias</td><td>Sen</td><td></td><td>POR</td><td>2191</td><td>ST. Julian's School</td><td>6,5</td><td>37,5</td></tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  const rows = parseStandingRows(html);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Gustavo Martins Santos, Ribeiro');
  assert.equal(rows[0].category, 'U20');
  assert.equal(rows[0].club, 'Ax Gaia');
  assert.equal(rows[0].points, 7);
  assert.equal(rows[1].name, 'Ricardo Pedro Cruz, Dias');
  assert.equal(rows[1].points, 6.5);
});

test('parses completed standings with title and no category columns', () => {
  const html = `
    <table>
      <tr><th>Rk.</th><th>Nº.Inic.</th><th></th><th>Nome</th><th>FED</th><th>Elo</th><th>Clube/Cidade</th><th>Pts.</th><th>Desp1</th></tr>
      <tr><td>1</td><td>1</td><td>FM</td><td>Sismeiro, Miguel</td><td>POR</td><td>2192</td><td>Xadrez Colégio Efanor (Nf)</td><td>6,5</td><td>28,5</td></tr>
      <tr><td>2</td><td>10</td><td></td><td>Sousa, Pedro Simao</td><td>POR</td><td>1808</td><td>CA Tessera</td><td>5,5</td><td>26,5</td></tr>
    </table>
  `;

  const rows = parseStandingRows(html);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Sismeiro, Miguel');
  assert.equal(rows[0].club, 'Xadrez Colégio Efanor (Nf)');
  assert.equal(rows[0].points, 6.5);
  assert.equal(rows[1].name, 'Sousa, Pedro Simao');
});

test('parses completed standings that omit FIDE ids but include club/category columns', () => {
  const html = `
    <table>
      <tr><th>Rk.</th><th>Inic.</th><th>Nome</th><th>Tipo</th><th>Sexo</th><th>Clube/Cidade</th><th>Pts.</th></tr>
      <tr><td>1</td><td>4</td><td>Oliveira, Afonso Vieira Soares Da Silva</td><td>U12</td><td></td><td>Xadrez Colégio Efanor (Nf)</td><td>5,5</td></tr>
      <tr><td>5</td><td>7</td><td>Ribeiro, Rita Marina Da Costa</td><td>U18</td><td>w</td><td>Paredes Golfe Clube</td><td>4</td></tr>
    </table>
  `;

  const rows = parseStandingRows(html);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    position: 1,
    seed: 4,
    name: 'Oliveira, Afonso Vieira Soares Da Silva',
    category: 'U12',
    sex: undefined,
    club: 'Xadrez Colégio Efanor (Nf)',
    fideId: undefined,
    points: 5.5,
    raw: {
      header: ['rk.', 'inic.', 'nome', 'tipo', 'sexo', 'clube/cidade', 'pts.'],
      cells: ['1', '4', 'Oliveira, Afonso Vieira Soares Da Silva', 'U12', '', 'Xadrez Colégio Efanor (Nf)', '5,5'],
      seed: 4,
      category: 'U12',
      sex: undefined,
      club: 'Xadrez Colégio Efanor (Nf)',
      fideId: undefined,
      points: 5.5,
    },
  });
  assert.equal(rows[1].sex, 'w');
});
