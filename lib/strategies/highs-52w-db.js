import { neon } from "@neondatabase/serverless";
import { SHARES_MIN } from "./highs-52w.js";

// Read-only selective aggregation against the existing grouping cache. No runtime backfill.
export async function getHighs52Cache(sessions, date, { databaseUrl = process.env.DATABASE_URL, coverageOnly = false } = {}) {
  if (!databaseUrl) return { status: "cache_unavailable", cachedDates: [], candidates: [] };
  const sql = neon(databaseUrl);
  const required = JSON.stringify(sessions);
  const days = await sql`
    SELECT trade_date::text AS date, updated_at::text AS refreshed
    FROM grouped_daily_payloads
    WHERE trade_date IN (SELECT value::date FROM jsonb_array_elements_text(${required}::jsonb))
      AND bar_count > 0 AND jsonb_typeof(bars) = 'array' AND bars <> '[]'::jsonb
    ORDER BY trade_date`;
  const cachedDates = days.map((item) => item.date);
  if (coverageOnly || days.length !== sessions.length) return { status: "pending_history", cachedDates, candidates: [] };
  const refresh = days.map(row => Date.parse(row.refreshed));
  const earliestRefresh = refresh.every(Number.isFinite) ? new Date(Math.min(...refresh)).toISOString().slice(0,10) : null;
  const candidates = await sql`
    WITH eligible AS MATERIALIZED (
      SELECT x.ticker, x.high, x.close, x.volume
      FROM grouped_daily_payloads p
      CROSS JOIN LATERAL jsonb_to_recordset(p.bars) AS x(ticker text, high double precision, close double precision, volume double precision)
      WHERE p.trade_date = ${date}::date AND x.volume > ${SHARES_MIN} AND x.high > 0
    ), prior AS (
      SELECT x.ticker, max(x.high) AS prior_high,
        bool_or(p.trade_date = ${sessions[0]}::date) AS first_session,
        count(DISTINCT p.trade_date)::int AS observations
      FROM grouped_daily_payloads p
      CROSS JOIN LATERAL jsonb_to_recordset(p.bars) AS x(ticker text, high double precision)
      JOIN eligible e ON e.ticker = x.ticker
      WHERE p.trade_date IN (SELECT value::date FROM jsonb_array_elements_text(${required}::jsonb))
        AND p.trade_date < ${date}::date AND x.high > 0
      GROUP BY x.ticker
    )
    SELECT e.ticker AS symbol, e.high, e.close, e.volume,
      h.prior_high AS "priorHigh", h.first_session AS "hasFirstSession", h.observations, f.type AS "cachedSecurityType"
    FROM eligible e LEFT JOIN prior h USING (ticker)
    LEFT JOIN ticker_fundamentals f ON f.ticker = e.ticker`;
  return { status: "ready", cachedDates, candidates, earliestRefresh };
}
