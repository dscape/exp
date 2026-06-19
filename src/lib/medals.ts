import type { MedalType } from './types';

export type MedalCompetition = 'overall' | 'category' | 'female' | 'team';

export type MedalAwardStanding = {
  position: number;
  playerId?: string;
  category?: string;
  sex?: string;
};

export type MedalCandidate = {
  playerId: string;
  type: MedalType;
  competition: MedalCompetition;
  place?: number;
  label?: string;
};

export function individualMedalCandidates(standings: MedalAwardStanding[]): MedalCandidate[] {
  return dedupeMedalCandidates([
    ...overallMedalCandidates(standings),
    ...categoryMedalCandidates(standings),
    ...femaleMedalCandidates(standings),
  ]);
}

export function medalTypeForPlace(place: number): MedalType | undefined {
  return place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : undefined;
}

export function podiumMedalName(type: MedalType) {
  return type === 'gold' ? 'Ouro' : type === 'silver' ? 'Prata' : 'Bronze';
}

function overallMedalCandidates(standings: MedalAwardStanding[]): MedalCandidate[] {
  return standings.flatMap((standing) => {
    const type = medalTypeForPlace(standing.position);
    return standing.playerId && type
      ? [{ playerId: standing.playerId, type, competition: 'overall', place: standing.position }]
      : [];
  });
}

function categoryMedalCandidates(standings: MedalAwardStanding[]): MedalCandidate[] {
  const byCategory = groupBy(standings.filter((standing) => standing.category), (standing) => normalizeCategoryCode(standing.category!));
  const candidates: MedalCandidate[] = [];
  for (const [category, rows] of byCategory) {
    rows
      .slice()
      .sort((a, b) => a.position - b.position)
      .slice(0, 3)
      .forEach((standing, index) => {
      if (!standing.playerId) return;
      const place = index + 1;
      const type = medalTypeForPlace(place);
      if (!type) return;
      candidates.push({
        playerId: standing.playerId,
        type,
        competition: 'category',
        place,
        label: `${ordinal(place)} ${formatCategoryLabel(category)}`,
      });
    });
  }
  return candidates;
}

function femaleMedalCandidates(standings: MedalAwardStanding[]): MedalCandidate[] {
  return standings
    .filter((standing) => isFemaleStanding(standing.sex))
    .slice()
    .sort((a, b) => a.position - b.position)
    .slice(0, 3)
    .flatMap((standing, index): MedalCandidate[] => {
      if (!standing.playerId) return [];
      const place = index + 1;
      const type = medalTypeForPlace(place);
      return type
        ? [{ playerId: standing.playerId, type, competition: 'female', place, label: `${ordinal(place, true)} feminina` }]
        : [];
    });
}

function dedupeMedalCandidates(candidates: MedalCandidate[]) {
  const seen = new Set<string>();
  const deduped: MedalCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.playerId}:${candidate.type}:${candidate.label ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function normalizeCategoryCode(category: string) {
  return category.trim().toUpperCase().replace(/\s+/g, '');
}

function formatCategoryLabel(category: string) {
  const normalized = normalizeCategoryCode(category);
  const sub = normalized.match(/^U0?(\d+)$/)?.[1];
  if (sub) return `Sub-${sub}`;
  if (normalized === 'SEN' || normalized === 'SENIOR') return 'Sénior';
  return normalized;
}

function isFemaleStanding(sex?: string) {
  return /^(w|f|female|feminino)$/i.test(sex ?? '');
}

function ordinal(place: number, feminine = false) {
  return `${place}.${feminine ? 'ª' : 'º'}`;
}
