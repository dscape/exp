import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchChessResultsEventImport } from '../src/lib/chess-results';

test('reports Chess-Results deleted tournaments as manual-only imports', async () => {
  const html = '<html><title>Chess-Results Server Chess-results.com - Base de dados de torneio</title><body>Record not found</body></html>';
  const fetcher = async () => new Response(html, { status: 200 });

  await assert.rejects(
    () => fetchChessResultsEventImport('https://s1.chess-results.com/tnr1255521.aspx?lan=10', fetcher),
    /apagado no Chess-Results.*manualmente.*classificações.*medalhas/i,
  );
});
