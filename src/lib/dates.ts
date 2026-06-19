export function normalizeBirthDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const pt = input.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  const compactPt = input.match(/^(\d{2})(\d{2})(\d{4})$/);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : pt
      ? { year: Number(pt[3]), month: Number(pt[2]), day: Number(pt[1]) }
      : compactPt
        ? { year: Number(compactPt[3]), month: Number(compactPt[2]), day: Number(compactPt[1]) }
        : null;
  if (!parts) return null;

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const valid =
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    parts.year >= 1900;
  if (!valid) return null;

  const normalized = `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
  return normalized <= todayIsoDate() ? normalized : null;
}

export function todayIsoDate() {
  const today = new Date();
  return `${today.getFullYear().toString().padStart(4, '0')}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
}
