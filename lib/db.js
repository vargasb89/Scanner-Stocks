import { neon } from "@neondatabase/serverless";

let schemaReady = false;

function getSql() {
  if (!process.env.DATABASE_URL) return null;
  return neon(process.env.DATABASE_URL);
}

async function ensureSchema(sql) {
  if (schemaReady) return;

  await sql`
    CREATE TABLE IF NOT EXISTS scan_runs (
      id BIGSERIAL PRIMARY KEY,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settings JSONB NOT NULL,
      meta JSONB NOT NULL,
      result_count INTEGER NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS scan_results (
      id BIGSERIAL PRIMARY KEY,
      scan_run_id BIGINT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      name TEXT,
      day_change_pct NUMERIC,
      free_float NUMERIC,
      shares_outstanding NUMERIC,
      volume NUMERIC,
      day_after_run DATE,
      market_cap NUMERIC,
      run_pct NUMERIC,
      retracement_pct NUMERIC,
      last_close NUMERIC,
      run_day DATE,
      latest_date DATE,
      payload JSONB NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS scan_results_scan_run_id_idx
    ON scan_results(scan_run_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS grouped_daily_payloads (
      trade_date DATE PRIMARY KEY,
      bars JSONB NOT NULL,
      bar_count INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS grouped_daily_bars (
      trade_date DATE NOT NULL,
      ticker TEXT NOT NULL,
      open NUMERIC,
      high NUMERIC,
      low NUMERIC,
      close NUMERIC,
      volume NUMERIC,
      PRIMARY KEY (trade_date, ticker)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS grouped_daily_bars_ticker_date_idx
    ON grouped_daily_bars(ticker, trade_date DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ticker_fundamentals (
      ticker TEXT PRIMARY KEY,
      name TEXT,
      market_cap NUMERIC,
      shares_outstanding NUMERIC,
      share_class_shares_outstanding NUMERIC,
      weighted_shares_outstanding NUMERIC,
      free_float NUMERIC,
      free_float_percent NUMERIC,
      primary_exchange TEXT,
      type TEXT,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  schemaReady = true;
}

function toDbDate(value) {
  return value || null;
}

function toDbNumber(value) {
  return Number.isFinite(value) ? value : null;
}

export async function saveScanRun({ settings, meta, results }) {
  const sql = getSql();
  if (!sql) return null;

  await ensureSchema(sql);

  const inserted = await sql`
    INSERT INTO scan_runs (settings, meta, result_count)
    VALUES (${JSON.stringify(settings)}::jsonb, ${JSON.stringify(meta)}::jsonb, ${results.length})
    RETURNING id
  `;

  const scanRunId = inserted[0]?.id;
  if (!scanRunId || results.length === 0) return scanRunId || null;

  for (const row of results) {
    await sql`
      INSERT INTO scan_results (
        scan_run_id,
        ticker,
        name,
        day_change_pct,
        free_float,
        shares_outstanding,
        volume,
        day_after_run,
        market_cap,
        run_pct,
        retracement_pct,
        last_close,
        run_day,
        latest_date,
        payload
      )
      VALUES (
        ${scanRunId},
        ${row.ticker},
        ${row.name || null},
        ${toDbNumber(row.dayChangePct)},
        ${toDbNumber(row.freeFloat)},
        ${toDbNumber(row.sharesOutstanding)},
        ${toDbNumber(row.volume)},
        ${toDbDate(row.dayAfterRun)},
        ${toDbNumber(row.marketCap)},
        ${toDbNumber(row.runPct)},
        ${toDbNumber(row.retracementPct)},
        ${toDbNumber(row.lastClose)},
        ${toDbDate(row.runDay)},
        ${toDbDate(row.latestDate)},
        ${JSON.stringify(row)}::jsonb
      )
    `;
  }

  return scanRunId;
}

export async function getCachedGroupedDay(date) {
  const sql = getSql();
  if (!sql) return null;

  await ensureSchema(sql);

  const payloadRows = await sql`
    SELECT bars
    FROM grouped_daily_payloads
    WHERE trade_date = ${date}
    LIMIT 1
  `;

  if (payloadRows[0]?.bars) return payloadRows[0].bars;

  const rows = await sql`
    SELECT
      ticker,
      open::float8 AS open,
      high::float8 AS high,
      low::float8 AS low,
      close::float8 AS close,
      volume::float8 AS volume,
      trade_date::text AS date
    FROM grouped_daily_bars
    WHERE trade_date = ${date}
  `;

  return rows.length ? rows : null;
}

export async function saveGroupedDay(date, bars) {
  const sql = getSql();
  if (!sql || !bars.length) return;

  await ensureSchema(sql);

  await sql`
    INSERT INTO grouped_daily_payloads (trade_date, bars, bar_count, updated_at)
    VALUES (${date}, ${JSON.stringify(bars)}::jsonb, ${bars.length}, NOW())
    ON CONFLICT (trade_date)
    DO UPDATE SET
      bars = EXCLUDED.bars,
      bar_count = EXCLUDED.bar_count,
      updated_at = NOW()
  `;
}

export async function getCachedFundamentals(ticker, maxAgeHours = 24) {
  const sql = getSql();
  if (!sql) return null;

  await ensureSchema(sql);

  const rows = await sql`
    SELECT
      ticker,
      name,
      market_cap::float8 AS "marketCap",
      shares_outstanding::float8 AS "sharesOutstanding",
      share_class_shares_outstanding::float8 AS "shareClassSharesOutstanding",
      weighted_shares_outstanding::float8 AS "weightedSharesOutstanding",
      free_float::float8 AS "freeFloat",
      free_float_percent::float8 AS "freeFloatPercent",
      primary_exchange AS "primaryExchange",
      type
    FROM ticker_fundamentals
    WHERE ticker = ${ticker}
      AND updated_at >= NOW() - (${maxAgeHours} || ' hours')::interval
    LIMIT 1
  `;

  return rows[0] || null;
}

export async function saveFundamentals(ticker, row) {
  const sql = getSql();
  if (!sql) return;

  await ensureSchema(sql);

  await sql`
    INSERT INTO ticker_fundamentals (
      ticker,
      name,
      market_cap,
      shares_outstanding,
      share_class_shares_outstanding,
      weighted_shares_outstanding,
      free_float,
      free_float_percent,
      primary_exchange,
      type,
      payload,
      updated_at
    )
    VALUES (
      ${ticker},
      ${row.name || null},
      ${toDbNumber(row.marketCap)},
      ${toDbNumber(row.sharesOutstanding)},
      ${toDbNumber(row.shareClassSharesOutstanding)},
      ${toDbNumber(row.weightedSharesOutstanding)},
      ${toDbNumber(row.freeFloat)},
      ${toDbNumber(row.freeFloatPercent)},
      ${row.primaryExchange || null},
      ${row.type || null},
      ${JSON.stringify(row)}::jsonb,
      NOW()
    )
    ON CONFLICT (ticker)
    DO UPDATE SET
      name = EXCLUDED.name,
      market_cap = EXCLUDED.market_cap,
      shares_outstanding = EXCLUDED.shares_outstanding,
      share_class_shares_outstanding = EXCLUDED.share_class_shares_outstanding,
      weighted_shares_outstanding = EXCLUDED.weighted_shares_outstanding,
      free_float = EXCLUDED.free_float,
      free_float_percent = EXCLUDED.free_float_percent,
      primary_exchange = EXCLUDED.primary_exchange,
      type = EXCLUDED.type,
      payload = EXCLUDED.payload,
      updated_at = NOW()
  `;
}
