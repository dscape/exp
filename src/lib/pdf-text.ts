import zlib from 'node:zlib';
import type { EventDeadline } from './types';

type FontMap = Map<string, Map<string, string>>;

const MONTHS: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  feb: 2,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  março: 3,
  marco: 3,
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

const MONTH_LABELS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

export function extractPdfText(buffer: Buffer) {
  const latin = buffer.toString('latin1');
  const fontMaps = extractFontMaps(buffer, latin);
  return extractContentStreams(buffer, latin)
    .map((stream) => extractTextFromContentStream(stream, fontMaps))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractRegistrationDeadlinesFromText(text: string, referenceDate?: string, sourceUrl?: string): EventDeadline[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const matches: EventDeadline[] = [];
  const patterns = [
    /(?:inscriç(?:ão|ões)|inscric(?:ao|oes)|registration|entries).{0,90}?(?:até|ate|limite|deadline|until|by|before).{0,35}?((?:\d{1,2}\s*(?:\/|-|\.)\s*\d{1,2}(?:\s*(?:\/|-|\.)\s*\d{2,4})?)|(?:\d{1,2}\s*(?:de\s*)?[A-Za-zÀ-ÿ]{3,12}(?:\s*(?:de\s*)?\d{4})?))/gi,
    /(?:até|ate|limite|deadline|until|by|before).{0,35}?((?:\d{1,2}\s*(?:\/|-|\.)\s*\d{1,2}(?:\s*(?:\/|-|\.)\s*\d{2,4})?)|(?:\d{1,2}\s*(?:de\s*)?[A-Za-zÀ-ÿ]{3,12}(?:\s*(?:de\s*)?\d{4})?)).{0,90}?(?:inscriç(?:ão|ões)|inscric(?:ao|oes)|registration|entries)/gi,
    /(?:prazo|deadline|limite).{0,60}?((?:\d{1,2}\s*(?:\/|-|\.)\s*\d{1,2}(?:\s*(?:\/|-|\.)\s*\d{2,4})?)|(?:\d{1,2}\s*(?:de\s*)?[A-Za-zÀ-ÿ]{3,12}(?:\s*(?:de\s*)?\d{4})?))/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized))) {
      const parsed = parseDeadlineDate(match[1], referenceDate);
      if (!parsed) continue;
      const duplicate = matches.some((deadline) => deadline.date === parsed.iso || deadline.value === parsed.label);
      if (duplicate) continue;
      matches.push({
        label: matches.length ? `${matches.length + 1}.º Prazo` : 'Prazo de inscrição',
        value: parsed.label,
        date: parsed.iso,
        sourceUrl,
      });
    }
  }

  return matches.slice(0, 4);
}

function extractFontMaps(buffer: Buffer, pdf: string): FontMap {
  const maps: FontMap = new Map();
  for (const match of pdf.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
    const fontObject = extractObject(pdf, Number(match[2]));
    const toUnicode = fontObject.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!toUnicode) continue;
    const cmap = extractObjectStream(buffer, pdf, Number(toUnicode[1]));
    if (cmap) maps.set(match[1], parseCMap(cmap));
  }
  return maps;
}

function extractContentStreams(buffer: Buffer, pdf: string) {
  const streams: string[] = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n/gms;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(pdf))) {
    const dictionary = match[1];
    const start = match.index + match[0].length;
    const end = pdf.indexOf('endstream', start);
    if (end < 0) break;
    const stream = inflatePdfStream(buffer.subarray(start, end), dictionary);
    if (stream && /\bBT\b/.test(stream)) streams.push(stream);
    streamPattern.lastIndex = end + 'endstream'.length;
  }
  return streams;
}

function extractObject(pdf: string, objectId: number) {
  const start = pdf.indexOf(`${objectId} 0 obj`);
  if (start < 0) return '';
  const end = pdf.indexOf('endobj', start);
  return end < 0 ? pdf.slice(start) : pdf.slice(start, end);
}

function extractObjectStream(buffer: Buffer, pdf: string, objectId: number) {
  const start = pdf.indexOf(`${objectId} 0 obj`);
  if (start < 0) return '';
  const streamStart = pdf.indexOf('stream', start);
  const objectEnd = pdf.indexOf('endobj', start);
  if (streamStart < 0 || (objectEnd >= 0 && streamStart > objectEnd)) return '';
  const dataStart = pdf.indexOf('\n', streamStart) + 1;
  const streamEnd = pdf.indexOf('endstream', dataStart);
  if (dataStart <= 0 || streamEnd < 0) return '';
  return inflatePdfStream(buffer.subarray(dataStart, streamEnd), pdf.slice(start, dataStart));
}

function inflatePdfStream(input: Buffer, dictionary: string) {
  let bytes = input;
  while (bytes.length && (bytes[bytes.length - 1] === 0x0a || bytes[bytes.length - 1] === 0x0d)) bytes = bytes.subarray(0, -1);
  if (!/FlateDecode/.test(dictionary)) return bytes.toString('latin1');
  try {
    return zlib.inflateSync(bytes).toString('latin1');
  } catch {
    try {
      return zlib.inflateRawSync(bytes).toString('latin1');
    } catch {
      return '';
    }
  }
}

function parseCMap(cmap: string) {
  const map = new Map<string, string>();
  for (const match of cmap.matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) {
    if (match[1].length > 4) continue;
    let value = '';
    for (let index = 0; index < match[2].length; index += 4) {
      value += String.fromCharCode(Number.parseInt(match[2].slice(index, index + 4), 16));
    }
    map.set(match[1].toUpperCase().padStart(2, '0'), value);
  }
  return map;
}

function extractTextFromContentStream(content: string, fontMaps: FontMap) {
  let currentFont = 'F1';
  let text = '';
  const tokenPattern = /(?:\/(F\d+)\s+[\d.]+\s+Tf)|(?:<([0-9A-Fa-f\s]+)>\s*Tj)|(?:\[((?:.|\n|\r)*?)\]\s*TJ)|(?:\((?:\\.|[^\\()])*\)\s*Tj)|(?:\bT\*\b)|(?:[\d.\-]+\s+[\d.\-]+\s+Td)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(content))) {
    if (match[1]) {
      currentFont = match[1];
      continue;
    }
    const cmap = fontMaps.get(currentFont);
    if (match[2]) {
      text += `${decodeHexString(match[2], cmap)} `;
    } else if (match[3]) {
      for (const hex of match[3].matchAll(/<([0-9A-Fa-f\s]+)>/g)) text += decodeHexString(hex[1], cmap);
      text += ' ';
    } else if (match[0] === 'T*' || /Td$/.test(match[0])) {
      text += '\n';
    } else if (match[0].startsWith('(')) {
      const end = match[0].lastIndexOf(')');
      text += `${decodePdfLiteral(match[0].slice(1, end))} `;
    }
  }
  return text;
}

function decodeHexString(hex: string, cmap?: Map<string, string>) {
  const compact = hex.replace(/\s+/g, '').toUpperCase();
  let output = '';
  for (let index = 0; index < compact.length; index += 2) {
    const code = compact.slice(index, index + 2);
    output += cmap?.get(code) ?? String.fromCharCode(Number.parseInt(code, 16));
  }
  return output;
}

function decodePdfLiteral(input: string) {
  let output = '';
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char !== '\\') {
      output += char;
      continue;
    }
    const next = input[++index];
    if (next === 'n') output += '\n';
    else if (next === 'r') output += '\r';
    else if (next === 't') output += '\t';
    else if (next === 'b') output += '\b';
    else if (next === 'f') output += '\f';
    else if (next === '(' || next === ')' || next === '\\') output += next;
    else if (/[0-7]/.test(next ?? '')) {
      let octal = next;
      for (let count = 0; count < 2 && /[0-7]/.test(input[index + 1] ?? ''); count++) octal += input[++index];
      output += String.fromCharCode(Number.parseInt(octal, 8));
    } else output += next ?? '';
  }
  return output;
}

function parseDeadlineDate(raw: string, referenceDate?: string) {
  const input = raw.trim().replace(/\s+de\s+/gi, ' ').replace(/\s+/g, ' ');
  const numeric = input.match(/^(\d{1,2})\s*(?:\/|-|\.)\s*(\d{1,2})(?:\s*(?:\/|-|\.)\s*(\d{2,4}))?$/);
  const named = input.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,12})(?:\s+(\d{4}))?$/);
  const reference = referenceDate ? parseIsoDate(referenceDate) : null;
  const parts = numeric
    ? { day: Number(numeric[1]), month: Number(numeric[2]), year: normalizeYear(numeric[3], reference?.year) }
    : named
      ? { day: Number(named[1]), month: MONTHS[slug(named[2])], year: normalizeYear(named[3], reference?.year) }
      : null;
  if (!parts?.month || !parts.year) return null;
  const date = isoDate(parts.year, parts.month, parts.day);
  if (!date) return null;
  return { iso: date, label: `${parts.day} ${MONTH_LABELS[parts.month - 1]}` };
}

function normalizeYear(year: string | undefined, fallback?: number) {
  if (!year) return fallback;
  const numeric = Number(year);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric < 100 ? 2000 + numeric : numeric;
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function slug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
