import assert from 'node:assert/strict';
import test from 'node:test';
import { chessResultsPgnRounds, chessResultsTournamentId, fetchChessResultsPgnDatabase } from '../src/lib/chess-results-pgn';

const SEARCH_HTML = `
<table>
<tr><td>37569</td><td><a href="partiesuche.aspx?lan=1&amp;art=4&amp;tnr=37569&amp;rd=1">Cup</a></td><td>1</td><td>36</td></tr>
<tr><td>37569</td><td><a href="partiesuche.aspx?lan=1&amp;art=4&amp;tnr=37569&amp;rd=6">Cup</a></td><td>6</td><td>35</td></tr>
</table>`;

const FORM_HTML = `
<form method="post" action="./partieSuche.aspx?lan=1">
<input type="hidden" name="__VIEWSTATE" value="state" />
<input type="hidden" name="__EVENTVALIDATION" value="validation" />
<input type="submit" name="ctl00$P1$cb_DownLoadPGN" value="Download as PGN-File" />
<input name="ctl00$P1$txt_dbkey" value="" />
<input name="ctl00$P1$txt_rdvon" value="" />
<input name="ctl00$P1$txt_rdbis" value="" />
</form>`;

const PGN = `[Event "1st Campomanes Cup Open"]
[Date "2010.08.28"]
[Round "1"]
[White "LE, Quang Liem"]
[Black "SAPTARSHI, Roy"]
[Result "1/2-1/2"]
[ECO "A00"]

1.d4 d5 2.c4 e6 1/2-1/2
`;

test('extracts Chess-Results tournament id and available PGN rounds', () => {
  assert.equal(chessResultsTournamentId('https://s1.chess-results.com/tnr37569.aspx?lan=1&art=2'), '37569');
  assert.deepEqual(chessResultsPgnRounds(SEARCH_HTML, '37569'), [1, 6]);
});

test('downloads Chess-Results PGN through partieSuche postback on the same node', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('art=3')) {
      return new Response(SEARCH_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (init?.method === 'POST') {
      const body = String(init.body);
      assert.match(body, /ctl00%24P1%24txt_dbkey=37569/);
      assert.match(body, /ctl00%24P1%24txt_rdvon=1/);
      assert.match(body, /ctl00%24P1%24txt_rdbis=6/);
      return new Response(PGN, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(FORM_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  };

  const imported = await fetchChessResultsPgnDatabase('https://s1.chess-results.com/tnr37569.aspx?lan=1&art=2&rd=8&SNode=S0', fetcher);

  assert.equal(imported.games.length, 1);
  assert.equal(imported.games[0].white, 'LE, Quang Liem');
  assert.deepEqual(imported.games[0].moves, ['d4', 'd5', 'c4', 'e6']);
  assert.equal(calls[1].url, 'https://s1.chess-results.com/partieSuche.aspx?lan=1');
  assert.equal(calls[2].url, 'https://s1.chess-results.com/partieSuche.aspx?lan=1');
});
