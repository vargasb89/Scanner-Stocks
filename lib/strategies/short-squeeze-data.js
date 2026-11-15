import { fetchTickerDailyRange, fetchTickerFloat, massiveFetch } from "../massive.js";
import { DEFAULTS, evaluateShortSqueeze } from "./short-squeeze.js";

const validSymbol = /^[A-Z][A-Z0-9.\-]{0,14}$/;
const choices = new Set(["yes", "no", "unverified"]);
const etClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
export const marketDate = (now) => {
  const fields = Object.fromEntries(etClock.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};
export const dateOffset = (date, days) => {
  const time = new Date(`${date}T00:00:00Z`);
  time.setUTCDate(time.getUTCDate() + days);
  return time.toISOString().slice(0, 10);
};
export const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && dateOffset(value, 0) === value && value >= "1900-01-01";

export function parseShortSqueezeQuery(query, today) {
  const symbol = (query.get("symbol") ?? query.get("ticker") ?? "").trim().toUpperCase();
  const d1Date = query.get("d1") ?? query.get("date") ?? "";
  const retentionMode = query.get("retentionMode") ?? DEFAULTS.retentionMode;
  const rvolThreshold = Number(query.get("rvolThreshold") ?? DEFAULTS.rvolThreshold);
  const confirmations = Object.fromEntries(["etbD1", "etbD2", "catalyst", "lowFloat"].map((key) => [key, query.get(key) ?? "unverified"]));
  if (!validSymbol.test(symbol) || !validDate(d1Date) || d1Date >= today) return { error: "Ingresa un símbolo y una fecha D1 anterior a hoy (Nueva York)." };
  if (!["low", "close"].includes(retentionMode) || !Number.isFinite(rvolThreshold) || rvolThreshold <= 0 || rvolThreshold > 1000 ||
      Object.values(confirmations).some((value) => !choices.has(value))) return { error: "Filtros de evaluación inválidos." };
  return { symbol, d1Date, settings: { retentionMode, rvolThreshold }, confirmations };
}

async function getReference(symbol, date) {
  const result = (await massiveFetch(`/v3/reference/tickers/${symbol}`, { date }))?.results;
  if (!result) return {};
  const isUsCommonStock = !result.locale || !result.market || !result.type ? null
    : result.locale === "us" && result.market === "stocks" && result.type === "CS";
  return { isUsCommonStock, sharesOutstanding: result.share_class_shares_outstanding ?? null };
}

export async function loadShortSqueeze(params, { now = new Date(), fetchBars = fetchTickerDailyRange, fetchReference = getReference, fetchFloat = fetchTickerFloat } = {}) {
  const today = marketDate(now);
  const input = parseShortSqueezeQuery(params, today);
  if (input.error) return { status: 400, body: input };
  const { symbol, d1Date } = input;
  const from = dateOffset(d1Date, -55);
  const to = [dateOffset(d1Date, 10), dateOffset(today, -1)].sort()[0];
  const barsPromise = fetchBars(symbol, from, to);
  const [barsResult, sessionsResult, refResult, floatResult] = await Promise.allSettled([
    barsPromise, symbol === "SPY" ? barsPromise : fetchBars("SPY", from, to), fetchReference(symbol, d1Date), fetchFloat(symbol),
  ]);
  const validRange = (rows) => Array.isArray(rows) ? rows.filter((row) => validDate(row.date) && row.date >= from && row.date <= to) : [];
  const bars = validRange(barsResult.value);
  const sessions = [...new Set(validRange(sessionsResult.value).map((bar) => bar.date))].sort();
  const dates = new Set(bars.map((bar) => bar.date));
  const sessionIndex = sessions.indexOf(d1Date);
  const previousDates = sessionIndex < 0 ? [] : sessions.slice(Math.max(0, sessionIndex - DEFAULTS.volumeLookback), sessionIndex);
  const expectedD2 = sessionIndex >= 0 ? (sessions[sessionIndex + 1] ?? null) : null;
  const floatValue = floatResult.value?.freeFloat;
  const latestFreeFloat = typeof floatValue === "number" && Number.isFinite(floatValue) && floatValue > 0 ? floatValue : null;
  const rawDate = floatResult.value?.floatEffectiveDate;
  const latestFloatEffectiveDate = validDate(rawDate) ? rawDate : null;
  const floatAsOf = latestFreeFloat !== null && latestFloatEffectiveDate !== null && latestFloatEffectiveDate <= d1Date
    ? latestFloatEffectiveDate : null;
  const reference = { ...refResult.value, freeFloat: floatAsOf ? latestFreeFloat : null };
  const data = {
    source: "Massive", adjusted: true, sessionSource: "SPY daily bars · NYSE Arca",
    barsStatus: barsResult.status === "rejected" ? "unavailable" : !dates.has(d1Date) ? "missing_d1" : "available",
    calendarStatus: sessionsResult.status === "rejected" || sessions.length === 0 ? "unavailable" : sessionIndex < 0 ? "not_market_session" : "available",
    referenceStatus: refResult.status === "rejected" ? "unavailable" : refResult.value?.isUsCommonStock == null ? "missing" : "available",
    expectedD2, d2SessionVerified: !!expectedD2 && dates.has(expectedD2),
    previousSessionVerified: previousDates.length > 0 && dates.has(previousDates.at(-1)),
    volumeSessionsVerified: previousDates.length === DEFAULTS.volumeLookback && previousDates.every((date) => dates.has(date)),
    floatStatus: floatAsOf ? "dated_observation" : latestFreeFloat === null ? "unavailable" :
      latestFloatEffectiveDate === null ? "undated" : "after_d1",
    latestFreeFloat, latestFloatEffectiveDate, floatAsOf, sharesOutstandingAsOf: refResult.value?.sharesOutstanding ? d1Date : null,
    sharesOutstandingBasis: "share_class_shares_outstanding · referencia D1 por periodo SEC; no certifica disponibilidad en D1",
  };
  // Use exchange-session dates only, so an unexpected or missing ticker bar does not shift D1/D2.
  const sessionSet = new Set(sessions);
  const verifiedBars = bars.filter((bar) => sessionSet.has(bar.date) || (bar.date === d1Date && data.calendarStatus === "unavailable"));
  if (!data.d2SessionVerified) {
    return { status: 200, body: evaluateShortSqueeze({ ...input, bars: verifiedBars, reference, data }) };
  }
  return { status: 200, body: evaluateShortSqueeze({
    ...input, bars: verifiedBars.filter((bar) => bar.date <= expectedD2), reference, data,
  }) };
}
