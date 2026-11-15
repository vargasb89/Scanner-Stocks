import { fetchTickerDailyRange, massiveFetch } from "../massive.js";
import { getHighs52Cache } from "./highs-52w-db.js";
import { summarizeHighs, WINDOW_DAYS } from "./highs-52w.js";
import { dateOffset, marketDate, validDate } from "./short-squeeze-data.js";

export async function fetch52Sessions(from, date) {
  const rows = await fetchTickerDailyRange("SPY", from, date);
  return [...new Set(rows.map(({date: day}) => day))]
    .filter((day) => validDate(day) && day >= from && day <= date).sort();
}

export async function fetch52Splits(from, through) {
  const datesByTicker = new Map();
  let result;
  for (let page = 0; page < 2; page++) {
    result = await massiveFetch(result?.next_url ?? "/stocks/v1/splits", page === 0
      ? { "execution_date.gte": from, "execution_date.lte": through, limit: 5000, sort: "execution_date.asc" } : {});
    if (!Array.isArray(result.results)) throw new Error("Incomplete split feed.");
    for (const row of result.results) {
      if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(row.ticker ?? "") || !validDate(row.execution_date)
        || row.execution_date < from || row.execution_date > through) throw new Error("Invalid split feed.");
      if (!datesByTicker.has(row.ticker) || datesByTicker.get(row.ticker) < row.execution_date) {
        datesByTicker.set(row.ticker, row.execution_date);
      }
    }
    if (!result.next_url) return Object.fromEntries(datesByTicker);
  }
  throw new Error("Incomplete split pagination.");
}

export async function loadHighs52(date, {
  now = new Date(), getSessions = fetch52Sessions, readCache = getHighs52Cache, getSplits = fetch52Splits,
} = {}) {
  const today = marketDate(now);
  if (!validDate(date) || date >= today || date < dateOffset(today, -365)) {
    return { status: 400, body: { error: "Elige una fecha pasada de Nueva York dentro del último año." } };
  }
  const from = dateOffset(date, -(WINDOW_DAYS - 1));
  let sessions;
  try { sessions = await getSessions(from, date); }
  catch (e) {
    return { status: e?.status === 429 ? 429 : 502, body: { error: e?.status === 429 ? "Massive alcanzó el límite de consultas. Intenta en un minuto." : "No se pudo verificar el calendario bursátil." } };
  }
  if (!sessions.length || sessions.at(-1) !== date) {
    return { status: 422, body: { error: "No se encontró una sesión bursátil cerrada para esa fecha." } };
  }
  // Avoid treating a truncated calendar as complete.
  if (sessions.length < 235 || sessions[0] > dateOffset(from, 7)) {
    return { status: 503, body: { error: "No hay cobertura suficiente para verificar el calendario de las 52 semanas." } };
  }
  let history;
  try { history = await readCache(sessions, date); }
  catch { return { status: 503, body: { error: "El historial de velas de 52 semanas aún no está disponible." } }; }
  const result = () => summarizeHighs({ date, from, sessions, ...history });
  if (history.status === "cache_unavailable") return { status: 503, body: { error: "El scanner no tiene conectado el historial diario." } };
  if (history.status !== "ready") return { status: 200, body: result() };
  try {
    const splitDates = await getSplits(from, today);
    return { status: 200, body: summarizeHighs({ date, from, sessions, ...history, splitDates }) };
  } catch (e) {
    return { status: e?.status === 429 ? 429 : 503, body: { error: "No fue posible confirmar los ajustes por splits. No se muestran máximos sin validar." } };
  }
}
