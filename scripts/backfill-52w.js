// Operator-only: run in the target environment with already configured credentials.
// Never run this from the public API. Process at most five missing sessions per invocation.
import { fetchGroupedDay } from "../lib/massive.js";
import { saveGroupedDay } from "../lib/db.js";
import { fetch52Sessions } from "../lib/strategies/highs-52w-data.js";
import { getHighs52Cache } from "../lib/strategies/highs-52w-db.js";
import { WINDOW_DAYS } from "../lib/strategies/highs-52w.js";
import { dateOffset, marketDate, validDate } from "../lib/strategies/short-squeeze-data.js";

async function run() {
  const [date, countArg = "3"] = process.argv.slice(2);
  const count = Number(countArg);
  const today = marketDate(new Date());
  if (!validDate(date) || date >= today || date < dateOffset(today, -365) || !Number.isInteger(count) || count < 1 || count > 5) {
    console.error("Usage: node scripts/backfill-52w.js YYYY-MM-DD [1..5]");
    return 2;
  }
  if (!process.env.DATABASE_URL || (!process.env.MASSIVE_API_KEY && !process.env.POLYGON_API_KEY)) {
    console.error("Configure operator environment for Neon and Massive; no credentials are accepted as arguments.");
    return 2;
  }
  const from = dateOffset(date, -(WINDOW_DAYS - 1));
  const sessions = await fetch52Sessions(from, date);
  if (sessions.length < 235 || sessions.at(-1) !== date || sessions[0] > dateOffset(from,7)) {
    console.error("The requested completed session or its trading calendar could not be verified.");
    return 2;
  }
  let coverage;
  try { coverage = await getHighs52Cache(sessions, date, { coverageOnly: true }); }
  catch (err) {
    // A fresh install creates these tables lazily; no other DB errors are treated as empty coverage.
    if (err?.code !== "42P01") throw err;
    coverage = { cachedDates: [] };
  }
  const cached = new Set(coverage.cachedDates);
  let filled = 0;
  let missing = 0;
  for (const day of sessions.toReversed()) {
    if (cached.has(day)) continue;
    if (filled >= count) { missing += 1; continue; }
    // At most four calls per minute on a single runner (plus a calendar call at startup).
    await new Promise(resolve => setTimeout(resolve, 16_000));
    const bars = await fetchGroupedDay(day);
    if (!bars.length) { missing += 1; continue; }
    await saveGroupedDay(day,bars);
    console.log("Cached " + day);
    filled += 1;
  }
  console.log(`Recorded ${filled} session(s); ${missing} missing session(s) remain.`);
  return 0;
}
try { process.exitCode = await run(); }
catch (e) {
  console.error(e?.status === 429 ? "Massive rate limit. Stop and wait before the next operator run." : "Market calendar or cache unavailable.");
  process.exitCode = 1;
}
