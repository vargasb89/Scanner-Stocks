import test from "node:test";
import assert from "node:assert/strict";
import { SHARES_MIN, summarizeHighs, WINDOW_DAYS } from "../lib/strategies/highs-52w.js";
import { loadHighs52 } from "../lib/strategies/highs-52w-data.js";
import { dateOffset } from "../lib/strategies/short-squeeze-data.js";

const date = "2026-11-13";
const from = dateOffset(date, -(WINDOW_DAYS - 1));
const sessions = Array.from({length: WINDOW_DAYS}, (_,i) => dateOffset(from,i)).filter(d=>![0,6].includes(new Date(d).getUTCDay()));
const sample = (symbol, overrides={}) => ({symbol, high:6, priorHigh:5, close:4, volume:SHARES_MIN+1, hasFirstSession:true, observations:200, ...overrides});
const fixture = { date, from, sessions, cachedDates:sessions };
test("strict volume threshold; session high counts even when the stock closes below it; ties labeled", () => {
  const r = summarizeHighs({...fixture,candidates:[
    sample("NEW"), sample("TIE",{priorHigh:6,volume:SHARES_MIN+200}), sample("ATMIN",{volume:SHARES_MIN}), sample("NOHIGH",{priorHigh:7}),
  ]});
  assert.deepEqual(r.rows.map(x=>[x.symbol,x.kind]), [["TIE","tie"],["NEW","new"]]);
  assert.equal(r.rows[1].close,4);
  assert.equal(r.rows[1].priorHigh,5);
  assert.equal(r.rows[1].sessionHigh,6);
});
test("missing shared session never produces false highs", () => {
  const r = summarizeHighs({...fixture,cachedDates:sessions.slice(1),candidates:[sample("NEW")]});
  assert.equal(r.status,"pending_history"); assert.deepEqual(r.meta.missingSessions,[sessions[0]]); assert.equal(r.rows.length,0);
});
test("new listings, stale split-adjusted prices and post-session share adjustments are withheld", () => {
  const r = summarizeHighs({...fixture,earliestRefresh:"2026-11-11",splitDates:{OLD:"2026-11-01",STALE:"2026-11-11",AFTER:"2026-11-16"},candidates:[
    sample("OLD"),sample("STALE"),sample("AFTER"),sample("IPO",{hasFirstSession:false}),
  ]});
  assert.deepEqual(r.rows.map(x=>x.symbol),["OLD"]);
  assert.equal(r.meta.adjustmentPending,2); assert.equal(r.meta.insufficientTickerHistory,1);
});
test("partial warehouse coverage avoids split feed and per-ticker requests", async () => {
  let called = 0;
  const r = await loadHighs52(date,{now:new Date("2026-11-15T15:00Z"),getSessions:async()=>sessions,readCache:async()=>({status:"pending_history",cachedDates:sessions.slice(1),candidates:[]}),getSplits:async()=>{called++;}});
  assert.equal(r.status,200); assert.equal(r.body.status,"pending_history"); assert.equal(called,0);
});
test("an unavailable split feed withholds highs rather than certifying mixed adjustments", async () => {
  const r = await loadHighs52(date,{now:new Date("2026-11-15T15:00Z"),getSessions:async()=>sessions,readCache:async()=>({status:"ready",cachedDates:sessions,candidates:[sample("ABC")]}),getSplits:async()=>{throw Error("provider unavailable");}});
  assert.equal(r.status,503); assert.equal(r.body.rows,undefined);
});
test("invalid or incomplete sessions never access warehouse", async () => {
  const noRead = ()=>{throw new Error("unexpected DB access");};
  const args = {now:new Date("2026-11-15T15:00Z"),getSessions:async()=>sessions.slice(40),readCache:noRead};
  assert.equal((await loadHighs52("2026-11-15",args)).status,400);
  assert.equal((await loadHighs52("2026-11-14",args)).status,422);
  assert.equal((await loadHighs52(date,args)).status,503);
});

test("known non-common types are excluded and unknown type is carried as such", () => {
  const result = summarizeHighs({...fixture,candidates:[sample("ETF",{cachedSecurityType:"ETF"}),sample("STOCK",{cachedSecurityType:"CS"}),sample("UNKNOWN")]});
  assert.equal(result.meta.excludedKnownNonCommon,1);
  assert.deepEqual(result.rows.map(r=>[r.symbol,r.cachedCommon]),[["STOCK",true],["UNKNOWN",false]]);
});
