const API_BASE = "https://api.massive.com";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey() {
  const key = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY;

  if (!key) {
    throw new Error("Falta MASSIVE_API_KEY en el entorno.");
  }

  return key;
}

async function massiveFetch(path, params = {}) {
  const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path}`);
  const apiKey = getApiKey();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  url.searchParams.set("apiKey", apiKey);

  let response;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!RETRYABLE_STATUS.has(response.status)) break;

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 3500 * (attempt + 1);
    await sleep(waitMs);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Massive ${response.status}: ${body.slice(0, 260)}`);
  }

  return response.json();
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function newYorkToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`);
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function getRecentCalendarDates(daysBack = 14) {
  const today = newYorkToday();
  const dates = [];

  for (let offset = 1; offset <= daysBack; offset += 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - offset);

    if (isWeekend(date)) continue;

    dates.push(isoDate(date));
  }

  return dates;
}

export async function fetchGroupedDay(date) {
  try {
    const data = await massiveFetch(
      `/v2/aggs/grouped/locale/us/market/stocks/${date}`,
      {
        adjusted: "true",
        include_otc: "false",
      },
    );

    return (data.results || []).map((bar) => ({
      ticker: bar.T,
      open: Number(bar.o),
      high: Number(bar.h),
      low: Number(bar.l),
      close: Number(bar.c),
      volume: Number(bar.v || 0),
      date,
    }));
  } catch (error) {
    if (String(error.message).includes("Attempted to request today's data")) {
      return [];
    }

    throw error;
  }
}

export async function fetchTickerDailyRange(ticker, from, to) {
  const data = await massiveFetch(
    `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}`,
    {
      adjusted: "true",
      sort: "asc",
      limit: 5000,
    },
  );

  return (data.results || []).map((bar) => ({
    ticker,
    open: Number(bar.o),
    high: Number(bar.h),
    low: Number(bar.l),
    close: Number(bar.c),
    volume: Number(bar.v || 0),
    date: new Date(bar.t).toISOString().slice(0, 10),
  }));
}

export async function fetchTickerDetails(ticker) {
  const data = await massiveFetch(`/v3/reference/tickers/${ticker}`);
  return data.results || {};
}

export async function fetchTickerFloat(ticker) {
  try {
    const data = await massiveFetch("/stocks/vX/float", { ticker, limit: 1 });
    const row = data.results?.[0];

    return {
      freeFloat: row?.free_float ?? null,
      freeFloatPercent: row?.free_float_percent ?? null,
      floatEffectiveDate: row?.effective_date ?? null,
    };
  } catch {
    return {
      freeFloat: null,
      freeFloatPercent: null,
      floatEffectiveDate: null,
    };
  }
}
