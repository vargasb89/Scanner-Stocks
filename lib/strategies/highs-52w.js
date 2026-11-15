export const SHARES_MIN = 5_000_000;
export const WINDOW_DAYS = 364; // D1 plus the prior 363 calendar days.
export const LIMIT = 200;

export function summarizeHighs({ date, from, sessions, cachedDates, candidates, splitDates = {}, earliestRefresh = null }) {
  const dateSet = new Set(cachedDates);
  const missing = sessions.filter((session) => !dateSet.has(session));
  const meta = { date, from, requiredSessions: sessions.length, coveredSessions: sessions.length - missing.length, missingSessions: missing, thresholdShares: SHARES_MIN, universe: "Mercado de EE. UU. sin OTC; se excluyen tipos no comunes conocidos. Los demás no están verificados a la fecha elegida.", splitRefreshFrom: earliestRefresh };
  if (missing.length || !sessions.length) return { status: "pending_history", rows: [], meta };
  const rows = [];
  let insufficientTickerHistory = 0;
  let adjustmentPending = 0;
  let excludedKnownNonCommon = 0;
  for (const row of candidates) {
    if (!Number.isFinite(row.volume) || row.volume <= SHARES_MIN || !Number.isFinite(row.high)) continue;
    if (row.cachedSecurityType && row.cachedSecurityType !== "CS") { excludedKnownNonCommon += 1; continue; }
    if (!row.hasFirstSession || !Number.isFinite(row.priorHigh)) { insufficientTickerHistory += 1; continue; }
    if (Object.hasOwn(splitDates, row.symbol) && (splitDates[row.symbol] > date || !earliestRefresh || earliestRefresh <= splitDates[row.symbol])) { adjustmentPending += 1; continue; }
    if (row.high < row.priorHigh) continue;
    rows.push({ symbol: row.symbol, close: row.close, sessionHigh: row.high, priorHigh: row.priorHigh,
      high52Week: Math.max(row.high, row.priorHigh), shares: row.volume,
      cachedCommon: row.cachedSecurityType === "CS", kind: row.high === row.priorHigh ? "tie" : "new", observations: row.observations });
  }
  rows.sort((a,b) => b.shares - a.shares || a.symbol.localeCompare(b.symbol));
  return { status: "ready", rows: rows.slice(0, LIMIT), meta: { ...meta, total: rows.length, insufficientTickerHistory, adjustmentPending, excludedKnownNonCommon } };
}
