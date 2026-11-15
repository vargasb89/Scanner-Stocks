import { getTicker, validTicker, apiError } from "@/lib/market-data";
export const dynamic = "force-dynamic";
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const ticker = (params.get("ticker") || "AAPL").trim().toUpperCase();
  const interval = params.get("interval") || "D";
  if (!validTicker(ticker) || !["1m","5m","D"].includes(interval)) return Response.json({error:"Símbolo o intervalo inválido."},{status:400});
  try { return Response.json(await getTicker(ticker,interval),{headers:{"Cache-Control":"no-store"}}); }
  catch(error) { return apiError(error); }
}
