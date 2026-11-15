import { cached } from "@/lib/market-data";
export const dynamic = "force-dynamic";
function field(item,name) {
  return (item.match(new RegExp(`<ndaq:${name}>([\\s\\S]*?)<\\/ndaq:${name}>`))?.[1] || "").trim();
}
export async function GET() {
  try {
    const data = await cached("halts",60000,async () => {
      const response = await fetch("https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts",{cache:"no-store",signal:AbortSignal.timeout(12000)});
      if(!response.ok) throw new Error("Feed no disponible");
      const xml = await response.text();
      if(!xml.includes("<rss")) throw new Error("Feed inválido");
      const rows = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match=>{
        const item=match[1];
        return {ticker:field(item,"IssueSymbol"),name:field(item,"IssueName"),date:field(item,"HaltDate"),time:field(item,"HaltTime").slice(0,8),reason:field(item,"ReasonCode"),resumptionDate:field(item,"ResumptionDate"),resumption:field(item,"ResumptionTradeTime").slice(0,8)};
      }).filter(row=>row.ticker);
      return {rows,source:"Nasdaq Trader",updated:xml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || null};
    });
    return Response.json(data);
  } catch { return Response.json({error:"No se pudo consultar el feed de suspensiones de Nasdaq. No se infieren halts a partir de falta de operaciones."},{status:503}); }
}
