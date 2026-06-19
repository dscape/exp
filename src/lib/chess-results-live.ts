import * as cheerio from 'cheerio';
import { parseChessResultsTeamStandings } from './chess-results';
import type { EventTeamStanding } from './types';

export type StandingImportRow = {
  position: number;
  seed?: number;
  name: string;
  club?: string;
  fideId?: string;
  category?: string;
  sex?: string;
  points: number | null;
  tieBreaks?: string[];
  raw: Record<string, unknown>;
};

export type PairingImportRow = {
  board: number;
  white: string;
  black: string;
  result?: string;
  raw: string[];
};

export function parseStandingRows(html: string): StandingImportRow[] {
  const teamStandings = parseChessResultsTeamStandings(html);
  if (teamStandings.length) return teamStandings.map(teamStandingToImportRow);

  const rows = extractHtmlRows(html);
  let best: StandingImportRow[] = [];
  for (const tableRows of rows) {
    const standings = parseStandingTableRows(tableRows);
    if (standings.length > best.length) best = standings;
  }
  return best;
}

export function parsePairingRows(html: string): PairingImportRow[] {
  const tables = extractHtmlRows(html)
    .map(parsePairingTableRows)
    .filter((rows) => rows.length > 0);
  if (!tables.length) return [];

  const singleRoundTables = tables.filter((rows) => rows.length <= 40);
  return singleRoundTables.at(-1) ?? tables.at(-1)!;
}

export function extractHtmlRows(html: string) {
  const $ = cheerio.load(html);
  const tables: string[][][] = [];
  $('table').each((_tableIndex, table) => {
    const rows: string[][] = [];
    $(table).children('tr,thead,tbody,tfoot').each((_i, child) => {
      if ($(child).is('tr')) collectRow($, child, rows);
      else $(child).children('tr').each((_j, tr) => collectRow($, tr, rows));
    });
    if (rows.length) tables.push(rows);
  });
  return tables;
}

function collectRow($: cheerio.CheerioAPI, tr: any, rows: string[][]) {
  const cells = $(tr).children('td,th').map((_j, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get();
  if (cells.some(Boolean)) rows.push(cells);
}

function teamStandingToImportRow(standing: EventTeamStanding): StandingImportRow {
  return {
    position: standing.position,
    seed: standing.seed,
    name: standing.name,
    club: standing.name,
    points: parseNumericScore(standing.matchPoints ?? '') ?? parseNumericScore(standing.boardPoints ?? ''),
    tieBreaks: standing.tieBreaks,
    raw: { kind: 'team', teamName: standing.name, standing },
  };
}

function parseStandingTableRows(tableRows: string[][]): StandingImportRow[] {
  const standings: StandingImportRow[] = [];
  const headerIndex = tableRows.findIndex((row) => row.some((cell) => /^rk\.?$|^rank$/i.test(slug(cell))) && row.some((cell) => /^nome$|^name$/i.test(slug(cell))) && row.some((cell) => /^pts\.?$|^points$/i.test(slug(cell))));
  if (headerIndex < 0) return standings;

  const header = tableRows[headerIndex].map(slug);
  const seedIndex = header.findIndex((cell) => /inic|start|seed/.test(cell));
  const nameIndex = header.findIndex((cell) => cell === 'nome' || cell === 'name');
  const categoryIndex = header.findIndex((cell) => /^tipo$|^type$|^cat/.test(cell));
  const sexIndex = header.findIndex((cell) => /^sexo$|^sex$/.test(cell));
  const clubIndex = header.findIndex((cell) => /clube|cidade|club|city/.test(cell));
  const fideIndex = header.findIndex((cell) => /fide/.test(cell));
  const pointsIndex = header.findIndex((cell) => /^pts\.?$|^points$/.test(cell));
  if (nameIndex < 0 || pointsIndex < 0) return standings;

  for (const row of tableRows.slice(headerIndex + 1)) {
    const position = Number(row[0]);
    if (!Number.isInteger(position) || position <= 0) {
      if (standings.length) break;
      continue;
    }
    const name = row[nameIndex];
    if (!name) continue;
    const fideId = fideIndex >= 0 && /^\d{4,12}$/.test(row[fideIndex] ?? '') ? row[fideIndex] : undefined;
    const category = categoryIndex >= 0 ? row[categoryIndex] || undefined : undefined;
    const sex = sexIndex >= 0 ? row[sexIndex] || undefined : undefined;
    const club = clubIndex >= 0 ? row[clubIndex] || undefined : undefined;
    const seed = seedIndex >= 0 ? Number(row[seedIndex]) : undefined;
    const points = pointsIndex >= 0 ? parseNumericScore(row[pointsIndex]) : parsePoints(row);
    standings.push({
      position,
      seed: Number.isInteger(seed) ? seed : undefined,
      name,
      category,
      sex,
      club,
      fideId,
      points,
      raw: { header, cells: row, seed, category, sex, club, fideId, points },
    });
  }
  return standings;
}

function parsePairingTableRows(tableRows: string[][]): PairingImportRow[] {
  const parsed: PairingImportRow[] = [];
  for (const row of tableRows) {
    const board = Number(row[0]);
    if (!Number.isInteger(board) || board <= 0) continue;

    const resultIndex = row.findIndex(isPairingResultCell);
    let white = firstNameCell(row.slice(1, resultIndex >= 0 ? resultIndex : row.length));
    let black = resultIndex >= 0
      ? firstNameCell(row.slice(resultIndex + 1))
      : undefined;

    if (!white || !black) {
      const names = row.slice(1).filter(isPairingNameCell);
      white ??= names[0];
      black ??= names.find((name) => name !== white);
    }

    if (!white || !black) continue;
    parsed.push({
      board,
      white,
      black,
      result: resultIndex >= 0 ? normalizePairingResult(row[resultIndex]) : undefined,
      raw: row,
    });
  }
  return parsed;
}

function firstNameCell(cells: string[]) {
  return cells.find(isPairingNameCell);
}

function isPairingNameCell(value: string) {
  const trimmed = value.trim();
  const normalized = slug(trimmed);
  if (!/[a-z]/i.test(normalized)) return false;
  if (isPairingResultCell(trimmed)) return false;
  if (/^\d+([,.]\d+)?$/.test(trimmed)) return false;
  if (/^[A-Z]{3}$/.test(trimmed)) return false;
  if (/^(u\d{1,2}|s\d{2}|sen|senior|w|f)$/i.test(trimmed)) return false;
  if (/^(rk\.?|rank|no\.?|nº|tab\.?|board|nome|name|fed|federacao|federation|tipo|type|pts\.?|points|resultado|result|res\.?|brancas|white|pretas|black)$/i.test(normalized)) return false;
  return trimmed.includes(',') || normalized.split(/\s+/).length >= 2;
}

function isPairingResultCell(value: string) {
  return /^(1-0|0-1|1\/2-1\/2|½-½|\+-|-\+|\*)$/i.test(compactResult(value));
}

function normalizePairingResult(value: string) {
  return compactResult(value).replace(/1\/2/g, '½');
}

function compactResult(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/½/g, '1/2');
}

function slug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function parsePoints(row: string[]) {
  const cell = row.find((value) => /^\d+([,.]\d+)?$|^\d+½$/.test(value));
  return cell ? parseNumericScore(cell) : null;
}

function parseNumericScore(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace('½', '.5').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
