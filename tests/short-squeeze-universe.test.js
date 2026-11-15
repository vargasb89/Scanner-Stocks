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
  assert.deepEqual(result.rows.map(({d1Volume,d2Volume}) => [d1Volume,d2Volume]), [[2000,4200],[5000,null]]);
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
  assert.equal(result.rows[0].d1Volume, 200);
  assert.equal(result.rows[0].d2Volume, null);
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
  assert.equal(result.rows[0].d1Volume, 1000);
  assert.equal(result.rows[0].d2Volume, 1000);
  assert.equal(result.rows[0].d2RetentionPct, 60);
  assert.equal(result.warning.includes("ETB"), true);
});

test("missing Preview credential returns a safe diagnostic before any provider request", async (t) => {
  const backups = Object.fromEntries(["MASSIVE_API_KEY", "POLYGON_API_KEY"].map((key) => [key, process.env[key]]));
  for (const key of Object.keys(backups)) delete process.env[key];
  t.after(() => {
    for (const [key, value] of Object.entries(backups)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  const resp = await GET(new Request("http://localhost/api/short-squeeze/universe?d1=2025-11-26"));
  assert.equal(resp.status, 503);
  assert.equal((await resp.json()).code, "MASSIVE_NOT_CONFIGURED");
  assert.equal(provider.mock.callCount(), 0);
});

test("provider authorization failure is distinct from a missing key", async (t) => {
  const backup = process.env.MASSIVE_API_KEY;
  process.env.MASSIVE_API_KEY = "mock";
  t.after(() => {
    if (backup === undefined) delete process.env.MASSIVE_API_KEY;
    else process.env.MASSIVE_API_KEY = backup;
  });
  t.mock.method(globalThis, "fetch", async () => new Response("untrusted provider payload", { status: 403 }));
  const resp = await GET(new Request("http://localhost/api/short-squeeze/universe?d1=2025-11-26"));
  assert.equal(resp.status, 502);
  const body = await resp.json();
  assert.equal(body.code, "MASSIVE_DATA_FORBIDDEN");
  assert.ok(!JSON.stringify(body).includes("untrusted provider payload"));
});

test("absent or invalid bar volumes remain pending, never reported as zero shares", () => {
  const result = rankShortSqueezeUniverse({
    previousBars: [bar("TEST", 10, 10, 100)],
    d1Bars: [bar("TEST", 14, 15, undefined)],
    d2Bars: [bar("TEST", 13, 14, 0)],
  });
  assert.equal(result.rows[0].d1Volume, null);
  assert.equal(result.rows[0].d2Volume, null);
  assert.equal(result.rows[0].d2RetentionPct, 75);
});
