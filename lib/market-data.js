import { massiveFetch, getRecentCalendarDates } from "./massive.js";

const state = globalThis.__momentumCache ||= { cache: new Map(), pending: new Map(), history: [] };

export async function cached(key, ttl, loader) {
  const hit = state.cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (state.pending.has(key)) return state.pending.get(key);
  const promise = loader().then(value => {
    if (state.cache.size > 600) state.cache.delete(state.cache.keys().next().value);
    state.cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  }).finally(() => state.pending.delete(key));
  state.pending.set(key, promise);
  return promise;
}

export function timestamp(value) {
  if (!value) return null;
  const numeric = Number(value);
  const ms = numeric > 1e17 ? numeric / 1e6 : numeric > 1e14 ? numeric / 1000 : numeric < 1e11 ? numeric * 1000 : numeric;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function number(value) { return value === undefined || value === null ? null : Number(value); }

export function snapshotRow(item) {
  const price = number(item.lastTrade?.p ?? item.min?.c ?? item.day?.c);
  const ask = number(item.lastQuote?.P), bid = number(item.lastQuote?.p);
  return {
    ticker: item.ticker, price, change: number(item.todaysChangePerc),
    high: number(item.day?.h), low: number(item.day?.l), open: number(item.day?.o),
    volume: number(item.day?.v), vwap: number(item.day?.vw),
    previousClose: number(item.prevDay?.c),
    spread: ask > 0 && bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null,
    updated: timestamp(item.lastTrade?.t || item.min?.t || item.updated),
    date: null, float: null, fiveMinute: null,
    nearHigh: price > 0 && item.day?.h > 0 && price >= item.day.h * 0.998,
  };
}

export async function getFloat(ticker) {
  return cached(`float:${ticker}`, 86400000, async () => {
    try {
      const data = await massiveFetch("/stocks/vX/float", { ticker, limit: 1 });
      return data.results?.[0]?.free_float ?? null;
    } catch { return null; }
  });
}

async function enrich(rows) {
  let index = 0;
  await Promise.all(Array.from({length: 3}, async () => {
    while (index < rows.length) {
      const row = rows[index++];
      row.float = await getFloat(row.ticker);
    }
  }));
  return rows;
}

async function dailyMarket() {
  const dates = getRecentCalendarDates(16);
  let day = null, previous = null, date = null;
  for (const candidate of dates) {
    const data = await cached(`grouped:${candidate}`, 3600000, () => massiveFetch(`/v2/aggs/grouped/locale/us/market/stocks/${candidate}`, { adjusted: true, include_otc: false }));
    if (!data.results?.length) continue;
    if (!day) { day = data.results; date = candidate; }
    else { previous = new Map(data.results.map(bar => [bar.T, bar])); break; }
  }
  if (!day || !previous) throw new Error("No hay dos sesiones disponibles para calcular los cambios de cierre.");
  const rows = day.map(bar => {
    const prev = previous.get(bar.T)?.c;
    return {
      ticker: bar.T, price: bar.c, change: prev > 0 ? (bar.c / prev - 1) * 100 : null,
      high: bar.h, low: bar.l, open: bar.o, volume: bar.v, vwap: bar.vw,
      previousClose: prev ?? null, spread: null, updated: null, date,
      float: null, fiveMinute: null, nearHigh: bar.h > 0 && bar.c >= bar.h * 0.998,
    };
  }).filter(row => row.price > 0 && Number.isFinite(row.change));
  return { rows, date };
}

export async function getMarket() {
  return cached("market", 60000, async () => {
    const warnings = [];
    let rows, mode, date = null;
    const snapshot = await cached("snapshot-access", 300000, async () => {
      try { return { data: await massiveFetch("/v2/snapshot/locale/us/markets/stocks/tickers", {include_otc: false}) }; }
      catch (error) { if (error.status === 403) return { denied: true }; throw error; }
    });
    if (snapshot.denied) {
      ({rows, date} = await dailyMarket());
      mode = "daily";
      warnings.push("Tu plan no incluye snapshots intradía. Se muestran cierres de la última sesión; 5m y spread no están disponibles.");
    } else {
      rows = (snapshot.data.tickers || []).map(snapshotRow).filter(row => row.price > 0 && Number.isFinite(row.change));
      mode = "snapshot";
      warnings.push("La frecuencia y el retraso de las cotizaciones dependen de tu plan de Massive. La hora de cada fila corresponde al proveedor.");
    }
    const candidates = rows.filter(row => row.volume >= 100000 && row.change > 0).sort((a,b) => b.change - a.change).slice(0,80);
    // Fetch real float for the leading names only; never substitute shares outstanding.
    await enrich(candidates.slice(0,12));
    const marketStatus = await cached("market-status", 60000, async () => {
      try { const data = await massiveFetch("/v1/marketstatus/now"); return data.market || "unknown"; }
      catch { return "unknown"; }
    });
    const indices = ["SPY","QQQ","DIA","IWM","VIXY","GLD"].map(t => rows.find(r => r.ticker === t)).filter(Boolean);
    if (mode === "snapshot") {
      const latest = new Map(rows.map(row => [row.ticker,row]));
      const asOf = Math.max(0,...candidates.map(r=>Date.parse(r.updated)||0));
      state.history.push({asOf, rows:latest});
      state.history = state.history.filter(p=>p.asOf >= asOf-7*60000).slice(-10);
      const comparison = state.history.filter(p => p.asOf <= asOf-5*60000).at(-1);
      if (comparison) for (const row of candidates) {
        const old = comparison.rows.get(row.ticker);
        // Only compare fresh, time-aligned observations from this process.
        const elapsed = Date.parse(row.updated)-Date.parse(old?.updated);
        if (old?.price > 0 && elapsed >= 270000 && elapsed <= 390000) row.fiveMinute = (row.price/old.price-1)*100;
      }
    }
    return { rows:candidates, indices, meta:{mode, date, marketStatus, scannedTickers:rows.length, generatedAt:new Date().toISOString(), warnings} };
  });
}

export function validTicker(ticker) { return /^[A-Z][A-Z0-9.\-]{0,14}$/.test(ticker); }

export async function getTicker(ticker, interval) {
  return cached(`ticker:${ticker}:${interval}`, 60000, async () => {
    const warnings = [];
    const dates = getRecentCalendarDates(16);
    const latest = dates[0];
    const tasks = await Promise.allSettled([
      cached(`details:${ticker}`,86400000,async () => (await massiveFetch(`/v3/reference/tickers/${ticker}`)).results || {}),
      getFloat(ticker),
      cached(`news:${ticker}`,300000,async () => (await massiveFetch("/v2/reference/news",{ticker,limit:12,sort:"published_utc",order:"desc"})).results || []),
    ]);
    const details = tasks[0].status === "fulfilled" ? tasks[0].value : {};
    const float = tasks[1].status === "fulfilled" ? tasks[1].value : null;
    const news = tasks[2].status === "fulfilled" ? tasks[2].value : [];
    if (tasks[2].status === "rejected") warnings.push("Las noticias no están disponibles en este momento.");
    let actualInterval = interval;
    let bars = [];
    const end = new Date();
    const start = new Date(end); start.setUTCDate(start.getUTCDate()-120);
    const dailyPath = `/v2/aggs/ticker/${ticker}/range/1/day/${start.toISOString().slice(0,10)}/${latest}`;
    if (interval !== "D") {
      const path = `/v2/aggs/ticker/${ticker}/range/${interval === "1m" ? 1 : 5}/minute/${latest}/${latest}`;
      try { bars = (await massiveFetch(path,{adjusted:true,sort:"asc",limit:5000})).results || []; }
      catch (error) { if (error.status !== 403) warnings.push(error.message); }
    }
    if (!bars.length) {
      if (interval !== "D") warnings.push("Sin velas intradía disponibles. El gráfico muestra velas diarias reales.");
      actualInterval = "D";
      try { bars = (await massiveFetch(dailyPath,{adjusted:true,sort:"asc",limit:5000})).results || []; }
      catch (error) { warnings.push(error.message); }
    }
    const cleanedBars = bars.map(b=>({time:b.t,open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v,vwap:b.vw}));
    const last = cleanedBars.at(-1), prior = cleanedBars.at(-2);
    let quote = null;
    try { const market = await getMarket(); quote = [...market.rows,...market.indices].find(r=>r.ticker===ticker) || null; }
    catch { /* Chart and reference data remain useful independently. */ }
    if (!quote && last) quote = { ticker, price:last.close, high:last.high, low:last.low, volume:last.volume, vwap:last.vwap, change:prior?.close > 0 ? (last.close/prior.close-1)*100 : null, date:new Date(last.time).toISOString().slice(0,10), updated:null };
    return {ticker,name:details.name || ticker,description:details.description || "",marketCap:details.market_cap ?? null,shares:details.weighted_shares_outstanding ?? null,float,quote,bars:cleanedBars,interval:actualInterval,news:news.map(n=>({id:n.id,title:n.title,url:/^https?:\/\//.test(n.article_url || "")?n.article_url:null,published:n.published_utc,publisher:n.publisher?.name || ""})),warnings};
  });
}

export function apiError(error) {
  const status = error.status === 401 ? 401 : error.status === 429 ? 429 : error.status === 403 ? 403 : 503;
  return Response.json({error:error.message || "No se pudieron cargar los datos."},{status,headers:{"Cache-Control":"no-store"}});
}
