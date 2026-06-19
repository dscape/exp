import type { GameRecord } from './types';

export type ParsedPgnGame = Omit<GameRecord, 'id' | 'annotations'> & {
  pgn: string;
  playedOn?: string;
  headers: Record<string, string>;
};

export type PgnDefaults = {
  event?: string;
  white?: string;
  black?: string;
  result?: string;
  eco?: string;
  playedOn?: string;
};

export function parsePgnGames(input: string, defaults: PgnDefaults = {}): ParsedPgnGame[] {
  const chunks = splitPgnGames(input);
  return chunks.map((chunk) => parsePgnGame(chunk, defaults)).filter(Boolean) as ParsedPgnGame[];
}

export function buildPgnDatabase(games: GameRecord[]) {
  return games.map((game) => game.pgn?.trim() || gameRecordToPgn(game)).filter(Boolean).join('\n\n');
}

export function gameRecordToPgn(game: Pick<GameRecord, 'white' | 'black' | 'event' | 'result' | 'eco' | 'moves'>) {
  const result = pgnResult(game.result || '*');
  const headers = [
    ['Event', game.event || '?'],
    ['White', game.white || '?'],
    ['Black', game.black || '?'],
    ['Result', result],
    ...(game.eco ? ([['ECO', game.eco]] as const) : []),
  ];
  return `${headers.map(([key, value]) => `[${key} "${escapePgnHeader(value)}"]`).join('\n')}\n\n${movesToText(game.moves)} ${result}`.trim();
}

function parsePgnGame(chunk: string, defaults: PgnDefaults): ParsedPgnGame | null {
  const headers = parseHeaders(chunk);
  const movesText = chunk.replace(/^\s*\[[^\n]*\]\s*$/gm, '').trim();
  const moves = parseMoves(movesText);
  const event = headers.Event || defaults.event || 'Partida PGN';
  const white = headers.White || defaults.white || '?';
  const black = headers.Black || defaults.black || '?';
  const result = pgnResult(headers.Result || defaults.result || resultFromMovesText(movesText) || '*');
  const eco = headers.ECO || defaults.eco || '';
  const playedOn = isoDateFromPgnDate(headers.Date) ?? defaults.playedOn;
  const pgn = normalizePgnChunk(chunk, { event, white, black, result, eco, playedOn, moves });
  if (!moves.length && !headers.White && !headers.Black) return null;
  return { white, black, event, result, eco, moves, pgn, playedOn, headers };
}

function splitPgnGames(input: string) {
  const normalized = input.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const starts = [...normalized.matchAll(/(?=^\s*\[Event\s+".*?"\])/gm)].map((match) => match.index ?? 0);
  if (starts.length <= 1) return [normalized];
  return starts.map((start, index) => normalized.slice(start, starts[index + 1] ?? normalized.length).trim()).filter(Boolean);
}

function parseHeaders(chunk: string) {
  const headers: Record<string, string> = {};
  for (const match of chunk.matchAll(/^\s*\[([A-Za-z0-9_]+)\s+"((?:\\"|[^"])*)"\]\s*$/gm)) {
    headers[match[1]] = match[2].replace(/\\"/g, '"');
  }
  return headers;
}

function parseMoves(text: string) {
  return text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^\d+\.(?:\.\.)?$/.test(token))
    .filter((token) => !/^\d+\.\.\.$/.test(token))
    .filter((token) => !/^\$\d+$/.test(token))
    .filter((token) => !['1-0', '0-1', '1/2-1/2', '*'].includes(token))
    .map((token) => token.replace(/^\d+\.{1,3}/, '').replace(/[!?]+$/g, ''))
    .filter(Boolean);
}

function movesToText(moves: string[]) {
  const parts: string[] = [];
  for (let index = 0; index < moves.length; index += 2) {
    const moveNumber = index / 2 + 1;
    parts.push(`${moveNumber}. ${moves[index]}${moves[index + 1] ? ` ${moves[index + 1]}` : ''}`);
  }
  return parts.join(' ');
}

function normalizePgnChunk(
  chunk: string,
  fallback: Pick<ParsedPgnGame, 'event' | 'white' | 'black' | 'result' | 'eco' | 'playedOn' | 'moves'>,
) {
  if (/^\s*\[Event\s+"/m.test(chunk)) return chunk.trim();
  return gameRecordToPgn(fallback);
}

function resultFromMovesText(text: string) {
  const match = text.match(/(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)(?:\s|$)/);
  return match?.[1];
}

function pgnResult(value: string) {
  const normalized = value.replace(/[–—]/g, '-').replace('½-½', '1/2-1/2').trim();
  return normalized === '1-0' || normalized === '0-1' || normalized === '1/2-1/2' || normalized === '*' ? normalized : '*';
}

function isoDateFromPgnDate(value: string | undefined) {
  const match = String(value ?? '').match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!match || match[1] === '????' || match[2] === '??' || match[3] === '??') return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function escapePgnHeader(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
