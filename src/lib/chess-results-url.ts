export function isChessResultsUrl(value: string) {
  try {
    const url = parseChessResultsUrlInput(value);
    return isChessResultsHost(url.hostname) && /tnr\d+\.aspx/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function chessResultsUrlWithParams(raw: string, params: Record<string, string>) {
  const url = new URL(raw, 'https://chess-results.com');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

export function normalizeChessResultsUrl(raw: string) {
  const url = parseChessResultsUrlInput(raw);
  if (!isChessResultsHost(url.hostname)) throw new Error('URL não é do Chess-Results.');
  if (!/tnr\d+\.aspx/i.test(url.pathname)) throw new Error('URL Chess-Results sem identificador de torneio.');
  for (const key of ['art', 'fed', 'snr', 'rd', 'flag', 'zeilen', 'prt', 'excel', 'turdet', 'SNode']) url.searchParams.delete(key);
  url.searchParams.set('lan', '10');
  return url.toString();
}

function parseChessResultsUrlInput(raw: string) {
  const input = raw.trim();
  if (/^https?:\/\//i.test(input)) return new URL(input);
  if (/^tnr\d+\.aspx/i.test(input)) return new URL(input, 'https://chess-results.com/');
  return new URL(`https://${input}`);
}

function isChessResultsHost(hostname: string) {
  return /(^|\.)chess-results\.com$/i.test(hostname);
}
