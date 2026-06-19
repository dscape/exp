import { parsePgnGames, type ParsedPgnGame } from './pgn';

export type ChessResultsPgnImport = {
  tnr: string;
  sourceUrl: string;
  downloadUrl: string;
  rounds: number[];
  games: ParsedPgnGame[];
  pgn: string;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchChessResultsPgnDatabase(
  eventUrl: string,
  fetcher: FetchLike = fetch,
): Promise<ChessResultsPgnImport> {
  const tnr = chessResultsTournamentId(eventUrl);
  if (!tnr) throw new Error('Chess-Results tournament id not found for PGN import.');
  const language = chessResultsLanguage(eventUrl);
  const initialOrigin = new URL(eventUrl).origin;
  const searchUrl = chessResultsGameSearchUrl(initialOrigin, language, tnr);
  const searchResponse = await fetcher(searchUrl, { headers: pgnHeaders() });
  if (!searchResponse.ok) throw new Error(`Chess-Results PGN search failed: ${searchResponse.status}`);
  const searchHtml = await searchResponse.text();
  const finalOrigin = safeOrigin(searchResponse.url) ?? initialOrigin;
  const rounds = chessResultsPgnRounds(searchHtml, tnr);
  if (!rounds.length) return { tnr, sourceUrl: searchUrl, downloadUrl: '', rounds, games: [], pgn: '' };

  const formUrl = chessResultsGameFormUrl(finalOrigin, language);
  const formResponse = await fetcher(formUrl, { headers: pgnHeaders() });
  if (!formResponse.ok) throw new Error(`Chess-Results PGN form failed: ${formResponse.status}`);
  const formHtml = await formResponse.text();
  const downloadUrl = safeOrigin(formResponse.url)
    ? chessResultsGameFormUrl(safeOrigin(formResponse.url)!, language)
    : formUrl;
  const fields = chessResultsPgnFormFields(formHtml, tnr, rounds);
  const pgnResponse = await fetcher(downloadUrl, {
    method: 'POST',
    headers: {
      ...pgnHeaders(),
      'content-type': 'application/x-www-form-urlencoded',
      referer: formUrl,
    },
    body: new URLSearchParams(fields),
  });
  if (!pgnResponse.ok) throw new Error(`Chess-Results PGN download failed: ${pgnResponse.status}`);
  const pgn = await pgnResponse.text();
  if (!/^\s*\[Event\s+"/m.test(pgn)) return { tnr, sourceUrl: searchUrl, downloadUrl, rounds, games: [], pgn: '' };
  return { tnr, sourceUrl: searchUrl, downloadUrl, rounds, games: parsePgnGames(pgn), pgn };
}

export function chessResultsTournamentId(input: string) {
  const url = new URL(input);
  const queryTnr = url.searchParams.get('tnr');
  if (queryTnr && /^\d+$/.test(queryTnr)) return queryTnr;
  return url.pathname.match(/tnr(\d+)\.aspx/i)?.[1];
}

export function chessResultsPgnRounds(html: string, tnr: string) {
  const rounds = new Set<number>();
  const escaped = tnr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkPattern = new RegExp(`partie[Ss]uche\\.aspx\\?[^"']*tnr=${escaped}[^"']*rd=(\\d+)`, 'gi');
  for (const match of html.matchAll(linkPattern)) rounds.add(Number(match[1]));

  const rowPattern = new RegExp(`<td[^>]*>\\s*${escaped}\\s*</td>[\\s\\S]*?<td[^>]*>\\s*(\\d+)\\s*</td>[\\s\\S]*?<td[^>]*>\\s*(\\d+)\\s*</td>`, 'gi');
  for (const match of html.matchAll(rowPattern)) {
    if (Number(match[2]) > 0) rounds.add(Number(match[1]));
  }

  return [...rounds].filter(Number.isFinite).sort((a, b) => a - b);
}

function chessResultsLanguage(input: string) {
  try {
    return new URL(input).searchParams.get('lan') || '1';
  } catch {
    return '1';
  }
}

function chessResultsGameSearchUrl(origin: string, language: string, tnr: string) {
  const url = new URL('/partieSuche.aspx', origin);
  url.searchParams.set('lan', language);
  url.searchParams.set('art', '3');
  url.searchParams.set('tnr', tnr);
  return url.toString();
}

function chessResultsGameFormUrl(origin: string, language: string) {
  const url = new URL('/partieSuche.aspx', origin);
  url.searchParams.set('lan', language);
  return url.toString();
}

function chessResultsPgnFormFields(html: string, tnr: string, rounds: number[]) {
  const fields = formInputFields(html);
  fields.set('ctl00$P1$txt_dbkey', tnr);
  fields.set('ctl00$P1$txt_rdvon', String(Math.min(...rounds)));
  fields.set('ctl00$P1$txt_rdbis', String(Math.max(...rounds)));
  fields.set('ctl00$P1$combo_anzahl_zeilen', '5');
  fields.set('ctl00$P1$combo_spielerfarbe', '-');
  fields.set('ctl00$P1$combo_ergebnis', '-');
  fields.set('ctl00$P1$cb_DownLoadPGN', 'Download as PGN-File');
  return fields;
}

function formInputFields(html: string) {
  const fields = new URLSearchParams();
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = input[0];
    const name = attributeValue(tag, 'name');
    if (!name) continue;
    const type = attributeValue(tag, 'type')?.toLowerCase();
    if (type === 'submit') continue;
    fields.set(htmlDecode(name), htmlDecode(attributeValue(tag, 'value') ?? ''));
  }
  return fields;
}

function attributeValue(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
  return match?.[1];
}

function htmlDecode(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function safeOrigin(url: string | undefined) {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

function pgnHeaders() {
  return {
    'user-agent': 'EscolaXadrezPorto/1.0 chess-results-pgn-import',
    accept: 'text/html,application/xhtml+xml,text/plain,*/*',
  };
}
