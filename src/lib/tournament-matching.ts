export type TournamentPlayer = {
  id: string;
  name: string;
  fideId?: string | null;
};

export type TournamentEntry = {
  name: string;
  fideId?: string | null;
  club?: string | null;
};

export function findTournamentPlayer<T extends TournamentPlayer>(
  players: T[],
  entry: TournamentEntry,
  startList: TournamentEntry[] = [],
): T | undefined {
  const fideId = normalizeFideId(
    entry.fideId ??
      findTournamentEntry(startList, entry.name)?.fideId,
  );
  if (fideId) {
    const byFide = players.find(
      (player) => normalizeFideId(player.fideId) === fideId,
    );
    if (byFide) return byFide;
  }

  const startListEntry = findTournamentEntry(startList, entry.name);
  const club = entry.club ?? startListEntry?.club;
  if (club && !isEfanorClub(club)) return undefined;

  const normalized = normalizePersonName(entry.name);
  const exact = players.filter(
    (player) => normalizePersonName(player.name) === normalized,
  );
  if (exact.length === 1) return exact[0];

  if (isEfanorClub(club)) {
    const importedTokens = personNameTokens(normalized);
    const fuzzy = players.filter((player) => {
      const playerTokens = [...personNameTokens(normalizePersonName(player.name))];
      return playerTokens.length >= 2 && playerTokens.every((token) => importedTokens.has(token));
    });
    if (fuzzy.length === 1) return fuzzy[0];
  }

  return undefined;
}

export function isClubTournamentName(
  name: string | undefined | null,
  startList: TournamentEntry[] = [],
  players: TournamentPlayer[] = [],
) {
  if (!name) return false;
  if (findTournamentPlayer(players, { name }, startList)) return true;
  return isEfanorClub(findTournamentEntry(startList, name)?.club);
}

export function findTournamentEntry(
  startList: TournamentEntry[],
  name: string,
): TournamentEntry | undefined {
  const normalized = normalizePersonName(name);
  return startList.find((row) => normalizePersonName(row.name) === normalized);
}

export function normalizeFideId(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\D/g, '') || trimmed.toLowerCase();
}

export function normalizePersonName(name: string) {
  const reordered = name.includes(',')
    ? `${name.split(',').slice(1).join(' ')} ${name.split(',')[0]}`
    : name;
  return reordered
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

export function isEfanorClub(club?: string | null) {
  return /efanor|xadrez\s+col[eé]gio\s+efanor|col[eé]gio\s+efanor/i.test(
    club ?? '',
  );
}

function personNameTokens(normalizedName: string) {
  const ignored = new Set(['a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e']);
  return new Set(normalizedName.split(/\s+/).filter((token) => token.length > 1 && !ignored.has(token)));
}
