import fs from 'node:fs/promises';
import { CHESS_RESULTS_USER_AGENT } from '../src/lib/chess-results';
import { extractPdfText, extractRegistrationDeadlinesFromText } from '../src/lib/pdf-text';

async function main() {
  const input = process.argv[2];
  const referenceDate = process.argv[3];
  if (!input) throw new Error('Usage: npm run extract:deadlines -- <pdf-url-or-path> [event-start-date:YYYY-MM-DD]');

  const buffer = /^https?:\/\//i.test(input) ? await download(input) : await fs.readFile(input);
  const text = extractPdfText(buffer);
  const deadlines = extractRegistrationDeadlinesFromText(text, referenceDate, input);
  console.log(JSON.stringify({ deadlines, textPreview: text.slice(0, 1200) }, null, 2));
}

async function download(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': CHESS_RESULTS_USER_AGENT, accept: 'application/pdf,*/*' } });
  if (!response.ok) throw new Error(`Failed to download PDF: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
