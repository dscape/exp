export type RecoveredIndividualStanding = {
  seed?: number;
  name: string;
  category?: string;
  sex?: string;
  club?: string;
  fideId?: string;
  points?: string;
};

export function recoverIndividualStanding(rawValue: unknown): RecoveredIndividualStanding | null {
  const raw = rawRecord(rawValue);
  const cells = stringArray(raw.cells);
  if (cells.length < 4) return null;
  const header = standingHeaderForCells(stringArray(raw.header), cells.length);
  return header ? standingFromHeader(cells, header) : standingFromCells(cells);
}

function standingHeaderForCells(header: string[], cellCount: number) {
  for (let index = 0; index <= header.length - cellCount; index++) {
    const slice = header.slice(index, index + cellCount).map(slug);
    if (
      /^rk\.?$|^rank$|^pos/.test(slice[0] ?? '') &&
      slice.some((cell) => cell === 'nome' || cell === 'name') &&
      slice.some((cell) => /^pts\.?$|^points$/.test(cell))
    ) {
      return slice;
    }
  }
  return null;
}

function standingFromHeader(cells: string[], header: string[]): RecoveredIndividualStanding | null {
  const seedIndex = header.findIndex((cell) => /inic|start|seed/.test(cell));
  const nameIndex = header.findIndex((cell) => cell === 'nome' || cell === 'name');
  const categoryIndex = header.findIndex((cell) => /^tipo$|^type$|^cat/.test(cell));
  const sexIndex = header.findIndex((cell) => /^sexo$|^sex$/.test(cell));
  const clubIndex = header.findIndex((cell) => /clube|cidade|club|city/.test(cell));
  const fideIndex = header.findIndex((cell) => /fide/.test(cell));
  const pointsIndex = header.findIndex((cell) => /^pts\.?$|^points$/.test(cell));
  const name = stringValue(cells[nameIndex]);
  if (!name || !looksLikeStandingName(name)) return null;
  return {
    seed: numberValue(cells[seedIndex]),
    name,
    category: categoryIndex >= 0 ? stringValue(cells[categoryIndex]) : undefined,
    sex: sexIndex >= 0 ? stringValue(cells[sexIndex]) : undefined,
    club: clubIndex >= 0 ? stringValue(cells[clubIndex]) : undefined,
    fideId: fideIndex >= 0 && /^\d{4,12}$/.test(cells[fideIndex] ?? '') ? cells[fideIndex] : undefined,
    points: pointsIndex >= 0 ? stringValue(cells[pointsIndex]) : undefined,
  };
}

function standingFromCells(cells: string[]): RecoveredIndividualStanding | null {
  let cursor = 1;
  const seed = /^\d+$/.test(cells[cursor] ?? '') ? Number(cells[cursor++]) : undefined;
  if (/^(?:GM|WGM|IM|WIM|FM|WFM|CM|WCM|NM|AFM)$/i.test(cells[cursor] ?? '')) cursor++;
  const name = stringValue(cells[cursor++]);
  if (!name || !looksLikeStandingName(name)) return null;
  const categories: string[] = [];
  while (/^(?:u\d{1,2}|s\d{2}|sen|senior|sub-?\d+|w|m|f)$/i.test(cells[cursor] ?? '')) categories.push(cells[cursor++]!);
  while (cells[cursor] === '') cursor++;
  const fideId = /^\d{4,12}$/.test(cells[cursor] ?? '') && !/^[A-Z]{3}$/i.test(cells[cursor + 1] ?? '') ? cells[cursor++] : undefined;
  if (/^[A-Z]{3}$/i.test(cells[cursor] ?? '')) cursor++;
  if (/^\d{1,4}$/.test(cells[cursor] ?? '')) cursor++;
  const club = stringValue(cells[cursor++]);
  const category = categories.join(' ') || undefined;
  return { seed, name, category, sex: sexCode(category), club, fideId, points: stringValue(cells[cursor]) };
}

function looksLikeStandingName(value: string) {
  const normalized = slug(value);
  if (!/[a-z]/.test(normalized)) return false;
  if (/^[a-z]{3}$/.test(normalized)) return false;
  if (/^\d+([,.]\d+)?$/.test(value)) return false;
  return true;
}

function rawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()) : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function sexCode(value?: string | null) {
  return value?.split(/\s+/).find((part) => /^(w|f|female|feminino)$/i.test(part));
}

function slug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
