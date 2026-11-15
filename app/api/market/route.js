import { getMarket, apiError } from "@/lib/market-data";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await getMarket(),{headers:{"Cache-Control":"no-store"}}); }
  catch(error) { return apiError(error); }
}
