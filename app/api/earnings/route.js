import { massiveFetch } from "@/lib/massive";
import { cached, apiError } from "@/lib/market-data";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const data = await cached("earnings",3600000,async () => {
      const from = new Date().toISOString().slice(0,10);
      const to = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      try {
        const result = await massiveFetch("/benzinga/v1/earnings",{"date.gte":from,"date.lte":to,sort:"date.asc",limit:60});
        return {available:true,rows:(result.results || []).map(r=>({ticker:r.ticker,date:r.date,time:r.time,eps:r.estimated_eps,revenue:r.estimated_revenue}))};
      } catch(error) {
        if(error.status === 403) return {available:false,rows:[],message:"El calendario requiere el complemento Benzinga Earnings, que no está incluido en tu plan actual."};
        throw error;
      }
    });
    return Response.json(data);
  } catch(error) { return apiError(error); }
}
