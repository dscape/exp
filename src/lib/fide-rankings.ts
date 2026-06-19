import type { Player, PlayerRatingHistoryPoint, RatingType } from './types';

export type FideRankingMetric = RatingType | 'combined';

export type FideRankingRow = Player & {
  medals: number;
  standard: number;
  rapid: number;
  blitz: number;
  combined: number;
  deltaStandard?: number;
  deltaRapid?: number;
  deltaBlitz?: number;
  deltaCombined?: number;
  rank: number;
  rankDelta?: number;
  groupRank: number;
  groupRankDelta?: number;
};

const CATEGORY_ORDER = [
  'Sub-8',
  'Sub-10',
  'Sub-12',
  'Sub-14',
  'Sub-16',
  'Sub-18',
  'Sub-20',
  'Sénior',
  'Veteranos',
  'Outros',
];

export function buildFideRankingRows(
  players: Player[],
  month: string | undefined,
  metric: FideRankingMetric,
  medalsByPlayerId: Record<string, number> = {},
): FideRankingRow[] {
  const current = players.map((player) => playerRatingSnapshot(player, month, medalsByPlayerId[player.id] ?? 0));
  const previousMonth = previousCalendarMonth(month);
  const previous = new Map(
    players.map((player) => {
      const snapshot = playerRatingSnapshot(player, previousMonth, medalsByPlayerId[player.id] ?? 0);
      return [player.id, snapshot];
    }),
  );

  const rankByPlayerId = rankingPositions(current, metric);
  const previousRankByPlayerId = rankingPositions([...previous.values()], metric);
  const groupRankByPlayerId = groupedRankingPositions(current, metric);
  const previousGroupRankByPlayerId = groupedRankingPositions([...previous.values()], metric);

  return current.map((row) => {
    const previousRow = previous.get(row.id);
    const rank = rankByPlayerId.get(row.id) ?? 0;
    const previousRank = previousRankByPlayerId.get(row.id);
    const groupRank = groupRankByPlayerId.get(row.id) ?? 0;
    const previousGroupRank = previousGroupRankByPlayerId.get(row.id);
    return {
      ...row,
      deltaStandard: ratingDelta(row.standard, previousRow?.standard),
      deltaRapid: ratingDelta(row.rapid, previousRow?.rapid),
      deltaBlitz: ratingDelta(row.blitz, previousRow?.blitz),
      deltaCombined: ratingDelta(row.combined, previousRow?.combined),
      rank,
      rankDelta: previousRank && rank ? previousRank - rank : undefined,
      groupRank,
      groupRankDelta: previousGroupRank && groupRank ? previousGroupRank - groupRank : undefined,
    };
  });
}

export function playerRatingSnapshot(player: Player, month: string | undefined, medals = 0) {
  const missingHistoryFallback = player.ratingHistory?.length ? 0 : undefined;
  const standard = ratingAtOrBefore(player, month, 'standard', missingHistoryFallback ?? player.standard);
  const rapid = ratingAtOrBefore(player, month, 'rapid', missingHistoryFallback ?? player.rapid);
  const blitz = ratingAtOrBefore(player, month, 'blitz', missingHistoryFallback ?? player.blitz);
  const combined = combinedRating(standard, rapid, blitz);
  return {
    ...player,
    standard,
    rapid,
    blitz,
    combined,
    medals,
  };
}

export function ratingAtOrBefore(
  player: Player,
  month: string | undefined,
  type: RatingType,
  fallback: number,
) {
  if (!month) return fallback;
  const history = player.ratingHistory ?? [];
  for (let index = history.length - 1; index >= 0; index--) {
    const point = history[index];
    if (point.listMonth <= month) {
      const rating = point[type];
      if (rating) return rating;
    }
  }
  return fallback;
}

export function combinedRating(standard: number, rapid: number, blitz: number) {
  const values = [standard, rapid, blitz].filter((rating) => rating > 0);
  return values.length ? Math.round(values.reduce((sum, rating) => sum + rating, 0) / values.length) : 0;
}

export function previousCalendarMonth(month: string | undefined) {
  const parsed = parseFideMonth(month);
  if (!parsed) return undefined;
  const previous = new Date(Date.UTC(parsed.year, parsed.month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function normalizeCategory(label: string) {
  if (/Sénior/i.test(label)) return 'Sénior';
  if (/Veterano/i.test(label)) return 'Veteranos';
  return label.match(/Sub-\d+/)?.[0] ?? 'Outros';
}

export function groupFideRankingRows<T extends Player>(rows: T[]) {
  return CATEGORY_ORDER.map((label) => ({
    label,
    rows: rows.filter((row) => normalizeCategory(row.category) === label),
  })).filter((group) => group.rows.length > 0);
}

function ratingDelta(current: number, previous: number | undefined) {
  return current > 0 && previous && previous > 0 ? current - previous : undefined;
}

function rankingPositions(rows: Array<Player & Record<FideRankingMetric, number>>, metric: FideRankingMetric) {
  return new Map(
    rows
      .filter((row) => row[metric] > 0)
      .slice()
      .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name, 'pt'))
      .map((row, index) => [row.id, index + 1]),
  );
}

function groupedRankingPositions(rows: Array<Player & Record<FideRankingMetric, number>>, metric: FideRankingMetric) {
  const positions = new Map<string, number>();
  for (const group of groupFideRankingRows(rows)) {
    for (const [index, row] of group.rows
      .filter((candidate) => candidate[metric] > 0)
      .slice()
      .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name, 'pt'))
      .entries()) {
      positions.set(row.id, index + 1);
    }
  }
  return positions;
}

function parseFideMonth(month: string | undefined) {
  const match = String(month ?? '').match(/^(\d{4})-(\d{2})-01$/);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function monthHasRating(point: PlayerRatingHistoryPoint | undefined, type: RatingType) {
  return Boolean(point?.[type]);
}
