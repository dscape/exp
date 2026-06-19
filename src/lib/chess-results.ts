import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as cheerio from 'cheerio';
import { todayIsoDate } from './dates';
import { chessResultsUrlWithParams, isChessResultsUrl, normalizeChessResultsUrl } from './chess-results-url';
import { extractPdfText, extractRegistrationDeadlinesFromText } from './pdf-text';
import type { ChessResultsEventImport, EventDocumentRecord, EventStartListEntry, EventStatus, EventTeamMember, EventTeamStanding, EventType } from './types';

export const CHESS_RESULTS_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 EscolaXadrezPorto/1.0';

const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MONTH_LOOKUP: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  feb: 2,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  marco: 3,
  março: 3,
  apr: 4,
  abr: 4,
  abril: 4,
  may: 5,
  mai: 5,
  maio: 5,
  jun: 6,
  junho: 6,
  jul: 7,
  julho: 7,
  aug: 8,
  ago: 8,
  agosto: 8,
  sep: 9,
  set: 9,
  setembro: 9,
  oct: 10,
  out: 10,
  outubro: 10,
  nov: 11,
  novembro: 11,
  dec: 12,
  dez: 12,
  dezembro: 12,
};
const PLAYER_TITLES = /^(GM|IM|FM|CM|WGM|WIM|WFM|WCM|NM|WNM|AIM|ACM|AFM)$/i;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type CheerioRoot = ReturnType<typeof cheerio.load>;
type ParsedDateRange = { startsOn?: string; endsOn?: string };
type ParsedImport = Omit<ChessResultsEventImport, 'sourceUrl' | 'fetchedAt'> & {
  registrationText?: string;
  locationInferred?: boolean;
  typeDefaulted?: boolean;
};

export { chessResultsUrlWithParams, isChessResultsUrl, normalizeChessResultsUrl } from './chess-results-url';

export class ChessResultsImportError extends Error {
  constructor(readonly code: 'tournament_not_found', message: string) {
    super(message);
    this.name = 'ChessResultsImportError';
  }
}

export function extractChessResultsTnr(raw: string) {
  const match = raw.match(/tnr(\d+)\.aspx/i) ?? raw.match(/[?&]tnr=(\d+)/i);
  return match?.[1];
}

export async function fetchChessResultsEventImport(rawUrl: string, fetcher: FetchLike = fetch): Promise<ChessResultsEventImport> {
  const sourceUrl = normalizeChessResultsUrl(rawUrl);
  const pageUrl = chessResultsUrlWithParams(sourceUrl, { lan: '10', art: '0', turdet: 'YES' });
  const html = await fetchTournamentHtml(pageUrl, fetcher);
  let parsed = parseChessResultsEventHtml(html, pageUrl);

  if (!parsed.startsOn) {
    const scheduleDates = await fetchScheduleDates(sourceUrl, fetcher);
    if (scheduleDates.startsOn) parsed = applyScheduleDates(parsed, scheduleDates);
  }

  if (parsed.format === 'team') {
    const teamMembers = await fetchTeamMembers(sourceUrl, fetcher);
    if (teamMembers.length) parsed = { ...parsed, teamMembers };
  }

  const pageDeadlines = extractRegistrationDeadlinesFromText(parsed.registrationText ?? '', parsed.startsOn, sourceUrl);
  const pdfDeadlines = await fetchPdfDeadlines(parsed.documents, parsed.startsOn, fetcher);
  const deadlines = mergeDeadlines(parsed.deadlines, mergeDeadlines(pageDeadlines, pdfDeadlines));
  const regulationUrl = parsed.regulationUrl ?? firstRegulationDocument(parsed.documents)?.url;
  const imported: ChessResultsEventImport = {
    ...stripInternalParsedImport(parsed),
    sourceUrl,
    chessResultsUrl: sourceUrl,
    chessResultsTnr: extractChessResultsTnr(sourceUrl),
    regulationUrl,
    deadlines,
    fetchedAt: new Date().toISOString(),
  };

  return {
    ...imported,
    fieldStatus: buildFieldStatus(imported, parsed),
    warnings: buildWarnings(imported, parsed),
  };
}

export function parseChessResultsEventHtml(html: string, pageUrl: string): ParsedImport {
  const $ = cheerio.load(html);
  const details = extractDetails($);
  const title = extractTournamentName($);
  const dates = parseDateRange(details.get('data') ?? title);
  const locationFromDetails = details.get('local');
  const location = locationFromDetails ?? locationFromTitle(title) ?? locationFromOrganizerTitle(title);
  const teamStandings = parseChessResultsTeamStandings(html);
  const initialRanking = teamStandings.length ? [] : extractInitialRanking($);
  const documents = extractDocumentLinks($, pageUrl);
  const type = inferEventType(details, title);
  const status = inferEventStatus(dates.startsOn, dates.endsOn);

  return {
    name: title || undefined,
    location: location || undefined,
    dateLabel: dates.startsOn ? formatDateLabel(dates.startsOn, dates.endsOn) : undefined,
    startsOn: dates.startsOn,
    endsOn: dates.endsOn ?? dates.startsOn,
    type,
    format: teamStandings.length ? 'team' : 'individual',
    status,
    season: dates.startsOn ? seasonFromDate(dates.startsOn) : undefined,
    month: dates.startsOn ? MONTHS[Number(dates.startsOn.slice(5, 7)) - 1] : undefined,
    participantsLabel: teamStandings.length ? `${teamStandings.length} equipas` : initialRanking.length ? `${initialRanking.length} inscritos` : undefined,
    deadlines: [],
    documents,
    initialRanking,
    teamStandings,
    registrationText: extractRegistrationText($),
    locationInferred: Boolean(location && !locationFromDetails),
    typeDefaulted: type === 'standard' && !hasTypeEvidence(details, title),
    warnings: [],
  };
}

async function fetchTeamMembers(sourceUrl: string, fetcher: FetchLike) {
  for (const art of ['8', '1']) {
    try {
      const html = await fetchText(chessResultsUrlWithParams(sourceUrl, { lan: '10', art }), fetcher);
      const members = parseChessResultsTeamMembers(html);
      if (members.length) return members;
    } catch {
      // Team composition is useful but not required for importing the event.
    }
  }
  return [];
}

export function parseChessResultsTeamStandings(html: string): EventTeamStanding[] {
  const $ = cheerio.load(html);
  let best: EventTeamStanding[] = [];
  $('table').each((_index, table) => {
    const rows = tableRows($, table);
    const parsed = parseTeamStandingRows(rows);
    if (parsed.length > best.length) best = parsed;
  });
  return best;
}

export function parseChessResultsTeamMembers(html: string): EventTeamMember[] {
  const $ = cheerio.load(html);
  let best: EventTeamMember[] = [];
  $('table').each((_index, table) => {
    const rows = tableRows($, table);
    const parsed = parseTeamMemberRows(rows);
    if (parsed.length > best.length) best = parsed;
  });
  return dedupeTeamMembers(best);
}

function parseTeamStandingRows(rows: string[][]): EventTeamStanding[] {
  const standings: EventTeamStanding[] = [];
  const headerIndex = rows.findIndex((row) => row.some((cell) => isTeamRankHeader(cell)) && row.some((cell) => /equipa|team/i.test(slug(cell))));
  if (headerIndex < 0) return standings;

  const header = rows[headerIndex].map((cell) => slug(cell));
  const positionIndex = header.findIndex((cell) => /^rk\.?$|^rank$|^pos|^class|^n[ºo.]?$/.test(cell));
  const seedIndex = header.findIndex((cell) => /inic|start|seed/.test(cell));
  const teamIndex = header.findIndex((cell) => /equipa|team/.test(cell));
  const playedIndex = header.findIndex((cell) => /^jogos$|^games$|^matches$|^m$/.test(cell));
  const winsIndex = header.findIndex((cell) => cell === '+' || /^w$|wins|vitorias/.test(cell));
  const drawsIndex = header.findIndex((cell) => cell === '=' || /^d$|draws|empates/.test(cell));
  const lossesIndex = header.findIndex((cell) => cell === '-' || /^l$|losses|derrotas/.test(cell));
  const matchPointsIndex = header.findIndex((cell) => /^mp$|matchpoints|match points|pontos de match/.test(cell));
  const boardPointsIndex = header.findIndex((cell) => /^bp$|boardpoints|board points|game-points|pontos de tabuleiro/.test(cell));
  const pointsIndex = header.findIndex((cell) => /^pts\.?$|^points$|^pontos$/.test(cell));
  const tieBreakIndexes = header
    .map((cell, index) => (/^desp|^tb|tie|buch|sonn|berger/i.test(cell) ? index : -1))
    .filter((index) => index >= 0);

  for (const row of rows.slice(headerIndex + 1)) {
    const position = parseInteger(row[positionIndex >= 0 ? positionIndex : 0]);
    if (!position) {
      if (standings.length) break;
      continue;
    }
    const name = cleanTeamName(row[teamIndex]);
    if (!name) continue;
    const tieBreaks = tieBreakIndexes.map((index) => row[index]).filter(Boolean);
    standings.push({
      position,
      seed: parseInteger(row[seedIndex]),
      name,
      played: parseInteger(row[playedIndex]),
      wins: parseInteger(row[winsIndex]),
      draws: parseInteger(row[drawsIndex]),
      losses: parseInteger(row[lossesIndex]),
      matchPoints: row[matchPointsIndex] || row[pointsIndex] || tieBreaks[0],
      boardPoints: row[boardPointsIndex] || tieBreaks[2],
      tieBreaks,
      raw: { kind: 'team', header, cells: row },
    });
  }

  return standings;
}

function parseTeamMemberRows(rows: string[][]): EventTeamMember[] {
  const members: EventTeamMember[] = [];
  let currentTeam: { rank: number; name: string; averageRating?: number; captain?: string } | null = null;
  let insideRoster = false;

  for (const row of rows) {
    const team = row.length === 1 ? parseTeamHeader(row[0]) : null;
    if (team) {
      currentTeam = team;
      insideRoster = false;
      continue;
    }

    if (!currentTeam) continue;
    if (row.some((cell) => /^tab\.?$|^board$/i.test(slug(cell))) && row.some((cell) => /^nome$|^name$/i.test(slug(cell)))) {
      insideRoster = true;
      continue;
    }

    if (!insideRoster) continue;
    const member = parseTeamMemberRow(row, currentTeam);
    if (member) members.push(member);
  }

  return members;
}

function parseTeamHeader(value: string) {
  const numbered = cleanText(value).match(/^(\d+)\.\s*(.+)$/);
  if (!numbered) return null;
  let rest = numbered[2].trim();
  const captain = rest.match(/\s+Capit[aã]o:\s*(.+)$/i)?.[1]?.trim();
  rest = rest.replace(/\s+Capit[aã]o:\s*.+$/i, '').trim();
  const averageRating = parseInteger(rest.match(/Elo\s+m[eé]dio:\s*(\d+)/i)?.[1]);
  const name = cleanTeamName(rest.replace(/\s*\([^)]*\)\s*$/, ''));
  return name ? { rank: Number(numbered[1]), name, averageRating, captain } : null;
}

function parseTeamMemberRow(row: string[], team: { rank: number; name: string }): EventTeamMember | null {
  let cursor = 0;
  const board = parseInteger(row[cursor++]);
  if (!board) return null;
  const title = PLAYER_TITLES.test(row[cursor] ?? '') ? row[cursor++] : undefined;
  const name = row[cursor++];
  if (!name || /^nome$|^name$/i.test(slug(name))) return null;
  const rating = parseInteger(row[cursor]);
  if (rating) cursor++;
  const federation = /^[A-Z]{3}$/i.test(row[cursor] ?? '') ? row[cursor++].toUpperCase() : undefined;
  const fideId = /^\d{4,12}$/.test(row[cursor] ?? '') ? row[cursor++] : undefined;
  const points = row[cursor++] || undefined;
  const games = parseInteger(row[cursor]);
  if (games) cursor++;
  const performance = parseInteger(row[cursor]);

  return {
    teamName: team.name,
    teamRank: team.rank,
    board,
    title,
    name,
    rating,
    federation,
    fideId,
    points,
    games,
    performance,
    raw: { kind: 'team-member', teamName: team.name, teamRank: team.rank, cells: row },
  };
}

function dedupeTeamMembers(members: EventTeamMember[]) {
  const seen = new Set<string>();
  const unique: EventTeamMember[] = [];
  for (const member of members) {
    const key = `${member.teamName}:${member.board ?? ''}:${member.fideId ?? member.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(member);
  }
  return unique;
}

function tableRows($: CheerioRoot, table: Parameters<CheerioRoot>[0]) {
  const rows: string[][] = [];
  $(table)
    .children('tr,thead,tbody,tfoot')
    .each((_rowIndex, child) => {
      if ($(child).is('tr')) collectTableRow($, child, rows);
      else $(child).children('tr').each((_childIndex, row) => collectTableRow($, row, rows));
    });
  return rows;
}

function collectTableRow($: CheerioRoot, row: Parameters<CheerioRoot>[0], rows: string[][]) {
  const cells = $(row).children('td,th').map((_cellIndex, cell) => cleanText($(cell).text())).get().filter(Boolean);
  if (cells.length) rows.push(cells);
}

function isTeamRankHeader(value: string) {
  const normalized = slug(value);
  return /^rk\.?$|^rank$|^pos|^class|^n[ºo.]?$/.test(normalized);
}

function cleanTeamName(value?: string) {
  const name = cleanText(value ?? '');
  return name && !/equipa|team|search|procurar/i.test(name) ? name : '';
}

function parseInteger(value?: string) {
  if (!value) return undefined;
  const numeric = Number(String(value).replace(',', '.'));
  return Number.isInteger(numeric) ? numeric : undefined;
}

async function fetchTournamentHtml(pageUrl: string, fetcher: FetchLike) {
  const html = await fetchText(pageUrl, fetcher);
  assertTournamentExists(html);
  const expanded = await tryFetchExpandedDetails(pageUrl, html, fetcher);
  if (expanded) assertTournamentExists(expanded);
  return expanded ?? html;
}

function assertTournamentExists(html: string) {
  const text = cleanText(html.replace(/<[^>]+>/g, ' '));
  if (/\bRecord not found\b|\bTournament not found\b|torneio\s+n[aã]o\s+encontrado/i.test(text)) {
    throw new ChessResultsImportError('tournament_not_found', 'Este torneio foi apagado no Chess-Results. Podes adicioná-lo manualmente, mas não haverá classificações nem medalhas automáticas.');
  }
}

async function tryFetchExpandedDetails(pageUrl: string, html: string, fetcher: FetchLike) {
  const $ = cheerio.load(html);
  if (!$('input[name="cb_alleDetails"]').length) return null;
  const body = new URLSearchParams();
  $('input').each((_index, input) => {
    const name = $(input).attr('name');
    if (!name || $(input).attr('type') === 'submit') return;
    body.set(name, $(input).attr('value') ?? '');
  });
  body.set('cb_alleDetails', $('input[name="cb_alleDetails"]').attr('value') ?? 'mostrar detalhes do torneio');
  const response = await fetcher(pageUrl, {
    method: 'POST',
    headers: { 'user-agent': CHESS_RESULTS_USER_AGENT, accept: 'text/html,application/xhtml+xml', 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) return null;
  const expanded = await response.text();
  return expanded.length > html.length ? expanded : null;
}

async function fetchScheduleDates(sourceUrl: string, fetcher: FetchLike): Promise<ParsedDateRange> {
  try {
    const scheduleUrl = chessResultsUrlWithParams(sourceUrl, { lan: '10', art: '14' });
    const html = await fetchText(scheduleUrl, fetcher);
    return parseScheduleDates(html);
  } catch {
    return {};
  }
}

function parseScheduleDates(html: string): ParsedDateRange {
  const $ = cheerio.load(html);
  const dates: string[] = [];
  $('tr').each((_index, row) => {
    const cells = $(row).find('td,th').map((_cellIndex, cell) => cleanText($(cell).text())).get().filter(Boolean);
    const iso = cells.find((cell) => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(cell));
    if (iso) dates.push(iso.replaceAll('/', '-'));
  });
  const unique = [...new Set(dates)].sort();
  return { startsOn: unique[0], endsOn: unique.at(-1) };
}

function applyScheduleDates(parsed: ParsedImport, dates: ParsedDateRange): ParsedImport {
  const startsOn = dates.startsOn;
  if (!startsOn) return parsed;
  const endsOn = dates.endsOn ?? startsOn;
  return {
    ...parsed,
    startsOn,
    endsOn,
    dateLabel: formatDateLabel(startsOn, endsOn),
    status: inferEventStatus(startsOn, endsOn),
    season: seasonFromDate(startsOn),
    month: MONTHS[Number(startsOn.slice(5, 7)) - 1],
  };
}

function stripInternalParsedImport(parsed: ParsedImport): Omit<ChessResultsEventImport, 'sourceUrl' | 'fetchedAt'> {
  const { registrationText: _registrationText, locationInferred: _locationInferred, typeDefaulted: _typeDefaulted, ...publicImport } = parsed;
  return publicImport;
}

function firstRegulationDocument(documents: EventDocumentRecord[]) {
  return (
    documents.find((document) => /regulamento|regulation|rules|bases|convite/i.test(`${document.label} ${document.url}`)) ??
    documents.find((document) => /\.pdf($|[?#])|UploadData\.aspx/i.test(document.url))
  );
}

function buildWarnings(imported: ChessResultsEventImport, parsed: ParsedImport) {
  const warnings: string[] = [];
  if (!imported.location) warnings.push('Local não encontrado no Chess-Results. Preenche manualmente.');
  else if (parsed.locationInferred) warnings.push('Local inferido a partir do nome/links; confirma antes de guardar.');
  if (!imported.startsOn) warnings.push('Datas não encontradas no Chess-Results. Preenche início/fim manualmente.');
  if (parsed.typeDefaulted) warnings.push('Tipo de prova não encontrado; Clássicas foi assumido por defeito.');
  if (!imported.deadlines.length) warnings.push('Prazo de inscrição não encontrado em Chess-Results/PDF. Preenche manualmente.');
  if (!imported.regulationUrl) warnings.push('Regulamento/PDF não encontrado.');
  if (imported.format === 'team' && !imported.teamMembers?.length) warnings.push('Composição das equipas não encontrada no Chess-Results.');
  if (imported.format !== 'team' && !imported.initialRanking.length) warnings.push('Ranking inicial não encontrado no Chess-Results.');
  return warnings;
}

function buildFieldStatus(imported: ChessResultsEventImport, parsed: ParsedImport): ChessResultsEventImport['fieldStatus'] {
  return {
    name: { label: 'Nome', status: imported.name ? 'found' : 'missing', value: imported.name },
    location: {
      label: 'Local',
      status: imported.location ? (parsed.locationInferred ? 'inferred' : 'found') : 'missing',
      value: imported.location,
      note: parsed.locationInferred ? 'inferido; confirma' : undefined,
    },
    dates: {
      label: 'Datas',
      status: imported.startsOn ? 'found' : 'missing',
      value: imported.dateLabel,
    },
    type: {
      label: 'Tipo',
      status: parsed.typeDefaulted ? 'defaulted' : 'found',
      value: imported.type,
      note: parsed.typeDefaulted ? 'assumido por defeito' : undefined,
    },
    deadline: {
      label: 'Prazo',
      status: imported.deadlines.length ? 'found' : 'missing',
      value: imported.deadlines.at(-1)?.value,
    },
    regulation: {
      label: 'Regulamento',
      status: imported.regulationUrl ? 'found' : 'missing',
      value: imported.regulationUrl,
    },
    initialRanking: {
      label: imported.format === 'team' ? 'Equipas' : 'Ranking inicial',
      status: imported.format === 'team' ? (imported.teamStandings?.length ? 'found' : 'missing') : imported.initialRanking.length ? 'found' : 'missing',
      value: imported.format === 'team'
        ? imported.teamStandings?.length
          ? `${imported.teamStandings.length} equipas`
          : undefined
        : imported.initialRanking.length
          ? `${imported.initialRanking.length} linhas`
          : undefined,
    },
  };
}

async function fetchText(url: string, fetcher: FetchLike) {
  const response = await fetcher(url, { headers: { 'user-agent': CHESS_RESULTS_USER_AGENT, accept: 'text/html,application/xhtml+xml' } });
  if (!response.ok) throw new Error(`Chess-Results respondeu ${response.status}: ${url}`);
  return response.text();
}

async function fetchPdfDeadlines(documents: EventDocumentRecord[], startsOn: string | undefined, fetcher: FetchLike) {
  const deadlines = [];
  const pdfs = documents
    .filter((document) => /\.pdf($|[?#])|UploadData\.aspx/i.test(document.url))
    .sort((a, b) => documentPriority(a) - documentPriority(b))
    .slice(0, 3);

  for (const document of pdfs) {
    try {
      if (!(await isSafeSecondaryDocumentUrl(document.url))) continue;
      const response = await fetcher(document.url, { headers: { 'user-agent': CHESS_RESULTS_USER_AGENT, accept: 'application/pdf,*/*' } });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') ?? '';
      if (!/pdf/i.test(contentType) && !/\.pdf($|[?#])|UploadData\.aspx/i.test(document.url)) continue;
      const text = extractPdfText(Buffer.from(await response.arrayBuffer()));
      deadlines.push(...extractRegistrationDeadlinesFromText(text, startsOn, document.url));
      if (deadlines.length) break;
    } catch {
      // PDF extraction is best-effort; the event import should still complete.
    }
  }

  return deadlines;
}

async function isSafeSecondaryDocumentUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (/(^|\.)chess-results\.com$/i.test(url.hostname)) return true;

  const literalIp = isIP(url.hostname);
  if (literalIp) return isPublicIpAddress(url.hostname, literalIp);

  try {
    const addresses = await lookup(url.hostname, { all: true });
    return addresses.length > 0 && addresses.every((address) => isPublicIpAddress(address.address, address.family));
  } catch {
    return false;
  }
}

function isPublicIpAddress(address: string, family: number) {
  if (family === 4) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false;
    return true;
  }

  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPublicIpAddress(mappedIpv4, 4);
  if (normalized === '::1' || normalized === '::') return false;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return false;
  return true;
}

function documentPriority(document: EventDocumentRecord) {
  const text = `${document.label} ${document.url}`;
  if (/regulamento|regulation|rules|bases/i.test(text) && /_pt|portugu[eê]s|regulamento/i.test(text)) return 0;
  if (/regulamento|regulation|rules|bases/i.test(text)) return 1;
  return 2;
}

function mergeDeadlines(existing: ChessResultsEventImport['deadlines'], imported: ChessResultsEventImport['deadlines']) {
  const merged = [...existing];
  for (const deadline of imported) {
    if (merged.some((item) => (item.date && item.date === deadline.date) || item.value === deadline.value)) continue;
    merged.push(deadline);
  }
  return merged.map((deadline, index) => ({ ...deadline, label: deadline.label || (index ? `${index + 1}.º Prazo` : 'Prazo de inscrição') }));
}

function extractTournamentName($: CheerioRoot) {
  const title = cleanText($('title').text()).replace(/^Chess-Results Server Chess-results\.com\s*-\s*/i, '');
  if (title && !/Link_To_Calendar/i.test(title)) return title;

  const headings = $('h1,h2,h3')
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter(Boolean)
    .filter((text) => !/nota:|ranking|classifica|tabela|emparceiramentos|pedidos de correc|inscriç/i.test(text));
  return headings[0] ?? title;
}

function extractDetails($: CheerioRoot) {
  const details = new Map<string, string>();
  const known = /^(organizador|federa|director|diretor|árbitro|arbitro|tempo de reflexão|tempo de reflexao|local|number of rounds|tournament type|cálculo|calculo|data|elo médio|elo medio|programa)/i;
  $('tr').each((_index, row) => {
    const cells = $(row).find('td,th').map((_cellIndex, cell) => cleanText($(cell).text())).get().filter(Boolean);
    if (cells.length !== 2 || !known.test(cells[0])) return;
    details.set(slug(cells[0]), cells[1]);
  });
  return details;
}

function extractRegistrationText($: CheerioRoot) {
  const headings = $('h1,h2,h3')
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter((text) => /inscriç|inscric|prazo|deadline|registration/i.test(text));
  return headings.join(' ');
}

function hasTypeEvidence(details: Map<string, string>, title: string) {
  const text = `${title} ${[...details.entries()].map(([key, value]) => `${key} ${value}`).join(' ')}`;
  return /standard|clássicas|classicas|classic|lentas|blitz|rápidas|rapidas|rapid|semi|semirrápidas|semi-rápidas|semi rapidas|tempo de reflexão \((?:standard|rapid|blitz)\)|tempo de reflexao \((?:standard|rapid|blitz)\)/i.test(text);
}

function extractDocumentLinks($: CheerioRoot, pageUrl: string): EventDocumentRecord[] {
  const documents: EventDocumentRecord[] = [];
  $('a').each((_index, link) => {
    const label = cleanText($(link).text());
    const href = $(link).attr('href');
    if (!href) return;
    const absolute = new URL(href, pageUrl).toString();
    const descriptor = `${label} ${absolute}`;
    if (!/\.pdf($|[?#])|UploadData\.aspx|GoogleMaps|maps\.app\.goo\.gl|facebook|instagram|Página oficial|Pagina oficial|Formulário|Formulario/i.test(descriptor)) return;
    if (/prt=5|exportar para pdf|export to pdf/i.test(descriptor)) return;
    if (documents.some((document) => document.url === absolute)) return;
    documents.push({ label: label || 'Documento', url: absolute });
  });
  return documents;
}

function extractInitialRanking($: CheerioRoot): EventStartListEntry[] {
  let best: EventStartListEntry[] = [];
  $('table').each((_index, table) => {
    const parsed = parseInitialRankingRows(tableRows($, table));
    if (parsed.length > best.length) best = parsed;
  });
  return best;
}

function parseInitialRankingRows(rows: string[][]) {
  const entries: EventStartListEntry[] = [];
  const headerIndex = rows.findIndex((row) => row.some((cell) => isNumberHeader(cell)) && row.some((cell) => /^nome$/i.test(slug(cell))) && row.some((cell) => /elo|rtg|rating/i.test(cell)));
  if (headerIndex < 0) return entries;

  const header = rows[headerIndex].map((cell) => slug(cell));
  const hasSourceId = header.some((cell) => /^id$|^id nacional$|^id fpx$/.test(cell));
  const hasClub = header.some((cell) => /clube|cidade|club|federação/i.test(cell));

  for (const row of rows.slice(headerIndex + 1)) {
    const number = Number(row[0]);
    if (!Number.isInteger(number) || number <= 0) {
      if (entries.length) break;
      continue;
    }
    const parsed = parseRankingRow(row, number, hasSourceId, hasClub);
    if (parsed) entries.push(parsed);
  }

  return dedupeStartList(entries);
}

function parseRankingRow(row: string[], number: number, hasSourceId: boolean, hasClub: boolean): EventStartListEntry | null {
  let cursor = 1;
  const title = PLAYER_TITLES.test(row[cursor] ?? '') ? row[cursor++] : undefined;
  const name = row[cursor++];
  if (!name || /^[A-Z]{3}$/.test(name)) return null;

  let sourceId: string | undefined;
  let fideId: string | undefined;
  if (hasSourceId && /^\d+$/.test(row[cursor] ?? '')) sourceId = row[cursor++];
  if (/^\d{4,12}$/.test(row[cursor] ?? '') && /^[A-Z]{3}$/i.test(row[cursor + 1] ?? '')) fideId = row[cursor++];

  const federation = /^[A-Z]{3}$/i.test(row[cursor] ?? '') ? row[cursor++].toUpperCase() : undefined;
  const rating = /^\d{1,4}$/.test(row[cursor] ?? '') ? Number(row[cursor++]) : undefined;
  while (/^\d{1,4}$/.test(row[cursor] ?? '')) cursor++;
  const extras = row.slice(cursor);
  const categoryParts: string[] = [];
  while (extras[0] && /^(w|m|u\d{2}|u\d+|s\d+|sen|sub\d+|sub-\d+)$/i.test(extras[0])) categoryParts.push(extras.shift()!);
  const club = hasClub && extras.length ? extras.join(' ') : undefined;

  return {
    number,
    name,
    sourceId,
    fideId,
    federation,
    rating,
    club,
    title,
    category: categoryParts.join(' ') || undefined,
    raw: { cells: row },
  };
}

function dedupeStartList(entries: EventStartListEntry[]) {
  const seen = new Set<string>();
  const unique: EventStartListEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.number ?? ''}:${entry.fideId ?? ''}:${entry.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function isNumberHeader(value: string) {
  return /^n[ºo.]|^no\.?$|^n\.?$|^nº\.?$/i.test(slug(value));
}

function inferEventType(details: Map<string, string>, title: string): EventType {
  const text = `${title} ${[...details.entries()].map(([key, value]) => `${key} ${value}`).join(' ')}`;
  if (/rapid|semi|semirrápidas|semi-rápidas|semi rapidas|\(rapid\)/i.test(text)) return 'rapid';
  if (/blitz|rápidas|rapidas|\(blitz\)/i.test(text)) return 'blitz';
  return 'standard';
}

function inferEventStatus(startsOn?: string, endsOn?: string): EventStatus {
  if (!startsOn) return 'upcoming';
  const today = todayIsoDate();
  const end = endsOn ?? startsOn;
  if (today > end) return 'completed';
  if (today >= startsOn && today <= end) return 'ongoing';
  return 'upcoming';
}

function parseDateRange(value: string): ParsedDateRange {
  const source = cleanText(value);
  const chessResults = source.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s*(?:até|a|-|–|to)\s*(\d{4})\/(\d{1,2})\/(\d{1,2}))?/i);
  if (chessResults) {
    return {
      startsOn: isoDate(Number(chessResults[1]), Number(chessResults[2]), Number(chessResults[3])),
      endsOn: chessResults[4] ? isoDate(Number(chessResults[4]), Number(chessResults[5]), Number(chessResults[6])) : undefined,
    };
  }

  const yearFromTitle = Number(source.match(/\b(20\d{2})\b/)?.[1]);
  const numericRange = source.match(/(\d{1,2})\s*\/\s*(\d{1,2}|[A-Za-zÀ-ÿ]{3,12})(?:\s*\/\s*(\d{2,4}))?\s*(?:-|–|a|até|to)\s*(\d{1,2})\s*\/\s*(\d{1,2}|[A-Za-zÀ-ÿ]{3,12})(?:\s*\/\s*(\d{2,4}))?/i);
  if (numericRange) {
    const endYear = normalizeYear(numericRange[6], yearFromTitle);
    const startYear = normalizeYear(numericRange[3], endYear);
    const startMonth = parseMonth(numericRange[2]);
    const endMonth = parseMonth(numericRange[5]);
    return {
      startsOn: startMonth ? isoDate(startYear, startMonth, Number(numericRange[1])) : undefined,
      endsOn: endMonth ? isoDate(endYear, endMonth, Number(numericRange[4])) : undefined,
    };
  }

  const single = source.match(/(\d{1,2})\s*\/\s*(\d{1,2}|[A-Za-zÀ-ÿ]{3,12})(?:\s*\/\s*(\d{2,4}))?/i);
  if (single) {
    const month = parseMonth(single[2]);
    const year = normalizeYear(single[3], yearFromTitle || new Date().getFullYear());
    return { startsOn: month ? isoDate(year, month, Number(single[1])) : undefined };
  }

  return {};
}

function locationFromTitle(title: string) {
  const parenthesized = title.match(/\(([^)]+)\)/)?.[1];
  if (!parenthesized) return undefined;
  const beforeDate = parenthesized.split(/,|\d{1,2}\s*\//)[0]?.trim();
  return beforeDate || undefined;
}

function locationFromOrganizerTitle(title: string) {
  const match = title.match(/\b(?:do|da|de)\s+(.+?)(?:\s+\d{4}|\s*\(|$)/i);
  const candidate = match?.[1]?.trim();
  if (!candidate || !/(clube|club|academia|centro|associaç|associac|escola|xadrez|golfe)/i.test(candidate)) return undefined;
  return candidate;
}

function seasonFromDate(iso: string) {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const start = month >= 9 ? year : year - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

function formatDateLabel(startsOn: string, endsOn?: string) {
  const start = parseIsoDate(startsOn);
  const end = endsOn ? parseIsoDate(endsOn) : start;
  if (!start || !end || startsOn === endsOn || !endsOn) return `${start?.day ?? ''} ${MONTHS[(start?.month ?? 1) - 1]}`.trim();
  if (start.month === end.month) return `${start.day}–${end.day} ${MONTHS[start.month - 1]}`;
  return `${start.day} ${MONTHS[start.month - 1]} – ${end.day} ${MONTHS[end.month - 1]}`;
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function parseMonth(value: string) {
  if (/^\d{1,2}$/.test(value)) return Number(value);
  return MONTH_LOOKUP[slug(value)];
}

function normalizeYear(year: string | undefined, fallback: number) {
  if (!year) return fallback;
  const numeric = Number(year);
  return numeric < 100 ? 2000 + numeric : numeric;
}

function isoDate(year: number, month: number, day: number) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function slug(value: string) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
