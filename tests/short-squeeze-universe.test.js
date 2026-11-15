import test from "node:test";
import assert from "node:assert/strict";
import { rankShortSqueezeUniverse } from "../lib/strategies/short-squeeze-universe.js";
import { GET } from "../app/api/short-squeeze/universe/route.js";

const bar = (ticker, close, high, volume, low = close) => ({ ticker, close, high, volume, low });
test("mechanical radar accepts inclusive price limits, excludes failed D2, and preserves missing D2", () => {
  const result = rankShortSqueezeUniverse({
    previousBars: ["PASS", "UPPER", "TOOFA", "FAIL"].map((ticker) => bar(ticker, 10, 10, 500)),
    d1Bars: [bar("PASS", 12, 14, 2000), bar("UPPER", 20, 20, 5000), bar("TOOFA", 21, 23, 2001), bar("FAIL", 15, 15, 6000)],
    d2Bars: [bar("PASS", 12, 13, 4200, 11), bar("FAIL", 13, 14, 1200, 12)],
  });
  assert.equal(result.total, 2);
  assert.equal(result.failedRetention, 1);
  assert.deepEqual(result.rows.map(({ symbol, d2RetentionPct }) => [symbol, d2RetentionPct]), [["PASS", 50], ["UPPER", null]]);
});

test("missing D2 never manufactures a passed check; takes top volume with result count intact", () => {
  const result = rankShortSqueezeUniverse({
    previousBars: [bar("A", 1, 1, 1), bar("B", 4, 4, 1), bar("C", 5, 5, 1)],
    d1Bars: [bar("A", 1.4, 1.5, 100), bar("B", 5.6, 6, 200), bar("C", 4.8, 6, 10_000)],
    d2Bars: null, limit: 1,
  });
  assert.equal(result.total, 2);
  assert.equal(result.rows[0].symbol, "B");
  assert.equal(result.rows[0].d2RetentionPct, null);
});

test("universe route uses the next exchange session and no credentials leave mocked fetch", async (t) => {
  const d1 = "2025-11-26";
  const sessions = ["2025-11-25", d1, "2025-11-28"];
  const ts = (day) => Date.parse(day + "T05:00:00Z");
  const origKey = process.env.MASSIVE_API_KEY;
  const calls = [];
  process.env.MASSIVE_API_KEY = "mock";
  t.after(() => {
    if (origKey === undefined) delete process.env.MASSIVE_API_KEY;
    else process.env.MASSIVE_API_KEY = origKey;
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.host, "api.massive.com");
    calls.push(url.pathname);
    if (url.pathname.includes("/ticker/SPY/")) return Response.json({ results: sessions.map((date) => ({ t: ts(date), c: 10 })) });
    const day = url.pathname.split("/").at(-1);
    assert.ok(sessions.includes(day), "Thanksgiving must not be queried as D2");
    return Response.json({ results: [{ T: "TEST", h: 18, c: day === d1 ? 15 : day === sessions[0] ? 10 : 13, l: 13, v: 1000 }] });
  });
  const resp = await GET(new Request("http://localhost/api/short-squeeze/universe?d1=" + d1));
  assert.equal(resp.status, 200);
  const result = await resp.json();
  assert.equal(result.previousDate, sessions[0]);
  assert.equal(result.d2Date, sessions[2]);
  assert.equal(calls.length, 4);
  assert.equal(result.rows[0].d2RetentionPct, 60);
  assert.equal(result.warning.includes("ETB"), true);
});
