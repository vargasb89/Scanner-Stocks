import test from "node:test";
import assert from "node:assert/strict";
import { dateOffset, loadShortSqueeze } from "../lib/strategies/short-squeeze-data.js";

const d1 = "2026-07-02";
const d2 = "2026-07-06"; // US Independence Day observed on Friday July 3.
const before = Array.from({ length: 34 }, (_, i) => dateOffset(d1, i - 34))
  .filter((date) => ![0, 6].includes(new Date(date).getUTCDay())).slice(-21)
  .map((date, i) => ({ date, close: 2, volume: i === 3 ? 10000 : 100 }));
const first = { date: d1, open: 2.8, close: 3, high: 3.23, volume: 300 };
const second = { date: d2, low: 2.49, close: 2.7, volume: 150 };
const third = { date: "2026-07-07", low: 2.6, close: 3.2, volume: 160 };
const calendar = [...before, first, second, third];
const defaults = { symbol: "FOO", d1, etbD1: "yes", etbD2: "yes", catalyst: "yes", lowFloat: "yes" };

function load(overrides = {}, { rows = calendar, now = "2026-07-08T20:00Z", market = calendar, float = {}, reference = { isUsCommonStock: true, sharesOutstanding: 50000000 } } = {}) {
  return loadShortSqueeze(new URLSearchParams({ ...defaults, ...overrides }), {
    now: new Date(now),
    fetchBars: async (ticker, _from, to) => (ticker === "SPY" ? market : rows).filter((row) => row.date <= to),
    fetchReference: async () => reference,
    fetchFloat: async () => float,
  });
}
const gate = (body, id) => body.checks.find((c) => c.id === id);

test("measures gain from adjusted prior close, D2 low and close, and 20-session median volume", async () => {
  const { body } = await load();
  assert.equal(body.d2Date, d2);
  assert.equal(body.metrics.d1ChangePct, 50);
  assert.equal(body.metrics.retentionFloor, 2.5);
  assert.ok(Math.abs(body.metrics.d2LowRetentionPct - 49) < 1e-8);
  assert.ok(Math.abs(body.metrics.d2CloseRetentionPct - 70) < 1e-8);
  assert.equal(body.metrics.volumeSamples, 20);
  assert.equal(body.metrics.volumeBaseline, 100);
  assert.equal(body.metrics.relativeVolume, 3);
  assert.equal(body.status, "excluded");
  assert.equal(gate(body, "retention").status, "fail");
});

test("explicit close mode; shares outstanding distinct from unavailable historical float", async () => {
  const { body } = await load({ retentionMode: "close" });
  assert.equal(body.status, "observation");
  assert.equal(body.metrics.freeFloat, null);
  assert.equal(body.metrics.sharesOutstanding, 50000000);
  assert.equal(gate(body, "freeFloat").status, "missing");
  assert.equal(gate(body, "sharesOutstanding").advisory, true);
  assert.deepEqual(body.d3, { referencePrice: 3.23, observationOnly: true, executionsEnabled: false });
});

test("holiday skipped, but a missing next ticker session cannot be silently replaced", async () => {
  const { body } = await load({ retentionMode: "close" }, { rows: [...before, first, third] });
  assert.equal(body.data.expectedD2, d2);
  assert.equal(body.d2Date, null);
  assert.equal(gate(body, "etbD2").status, "missing");
  assert.equal(gate(body, "retention").status, "missing");
  assert.equal(body.status, "pending");
});

test("today in NY is not considered a completed session even with a partial provider row", async () => {
  const { body } = await load({}, { now: "2026-07-07T01:00Z" });
  assert.equal(body.data.expectedD2, null);
  assert.equal(gate(body, "retention").status, "missing");
});

test("price alone is not sufficient; negative confirmations are failures, unknowns pending", async () => {
  const a = await load({ retentionMode: "close", etbD1: "unverified", catalyst: "unverified" });
  assert.equal(a.body.status, "pending");
  assert.equal(gate(a.body, "catalyst").status, "missing");
  const b = await load({ retentionMode: "close", etbD2: "no" });
  assert.equal(b.body.status, "excluded");
  assert.equal(gate(b.body, "etbD2").status, "fail");
});

test("gap in volume sample is unverified even if 20 dated ticker bars exist", async () => {
  const { body } = await load({ retentionMode: "close" }, { rows: calendar.filter((row) => row.date !== before.at(-5).date) });
  assert.equal(body.metrics.relativeVolume, null);
  assert.equal(gate(body, "relativeVolume").status, "missing");
});

test("invalid calendar dates and nonsensical overrides are rejected", async () => {
  assert.equal((await load({ d1: "2026-06-31" })).status, 400);
  assert.equal((await load({ rvolThreshold: "Infinity" })).status, 400);
  assert.equal((await load({ rvolThreshold: "" })).status, 400);
});

test("a provider outage is marked unavailable, never a failed strategy condition", async () => {
  const { body } = await loadShortSqueeze(new URLSearchParams(defaults), {
    now: new Date("2026-07-08T20:00Z"),
    fetchBars: async () => { throw new Error("provider unavailable"); },
    fetchReference: async () => { throw new Error("provider unavailable"); },
    fetchFloat: async () => { throw new Error("provider unavailable"); },
  });
  assert.equal(body.data.barsStatus, "unavailable");
  assert.equal(body.data.calendarStatus, "unavailable");
  assert.equal(body.data.referenceStatus, "unavailable");
  assert.equal(body.status, "pending");
  assert.equal(gate(body, "impulse").status, "missing");
});

test("latest float dated before D1 is evidence, but still not manual confirmation", async () => {
  const { body } = await load({ retentionMode: "close", lowFloat: "unverified" }, {
    float: { freeFloat: 7_000_000, floatEffectiveDate: "2026-06-11" },
  });
  assert.equal(body.status, "pending");
  assert.equal(gate(body, "lowFloat").status, "missing");
  assert.equal(body.metrics.freeFloat, 7_000_000);
  assert.equal(body.data.floatAsOf, "2026-06-11");
  assert.equal(body.data.floatStatus, "dated_observation");
});

test("newer or undated float observations are not applied historically", async () => {
  for (const [date, expected] of [["2026-07-08", "after_d1"], [null, "undated"]]) {
    const { body } = await load({ retentionMode: "close", lowFloat: "unverified" }, {
      float: { freeFloat: 7_000_000, floatEffectiveDate: date },
    });
    assert.equal(body.metrics.freeFloat, null);
    assert.equal(body.data.latestFreeFloat, 7_000_000);
    assert.equal(body.data.latestFloatEffectiveDate, date);
    assert.equal(body.data.floatStatus, expected);
    assert.equal(body.status, "pending");
  }
});

test("manual low-float denial excludes regardless of other gates", async () => {
  const { body } = await load({ retentionMode: "close", lowFloat: "no" });
  assert.equal(body.status, "excluded");
  assert.equal(gate(body, "lowFloat").status, "fail");
});

test("rejects an extreme open even when the closing impulse fits the range", async () => {
  const { body } = await load({ retentionMode: "close" }, { rows: [...before, { ...first, open: 8, high: 8.1 }, second] });
  assert.equal(gate(body, "impulse").status, "pass");
  assert.equal(body.metrics.d1OpenGapPct, 300);
  assert.equal(gate(body, "openingGap").status, "fail");
  assert.equal(body.status, "excluded");
});
