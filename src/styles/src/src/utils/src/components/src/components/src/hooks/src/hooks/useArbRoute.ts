import { useMemo } from "react";
import { fmtPct } from "../utils/format";

// NOTE: For demo, we infer a simple spread from two pseudo DEX sources.
// In production, pull quotes per DEX route (e.g., Jupiter quote with specific AMMs).
export type ArbRoute = {
  dexA: string;
  dexB: string;
  token: string;
  spreadPct: number;
  estProfitUsd: number;
  route: string[];
};

export const useArbRoutes = (solUsd?: number) => {
  return useMemo<ArbRoute[]>(() => {
    if (!solUsd) return [];
    // pretend Raydium is slightly cheaper than Orca (demo only)
    const raydiumPrice = solUsd * 0.998;
    const orcaPrice = solUsd * 1.002;

    const spread = (orcaPrice - raydiumPrice) / raydiumPrice; // buy on Raydium, sell on Orca
    const estProfitUsd = Math.max(spread, 0) * 100; // estimate for $100 notional

    const routes: ArbRoute[] = [
      {
        dexA: "Raydium",
        dexB: "Orca",
        token: "SOL/USDC",
        spreadPct: spread,
        estProfitUsd,
        route: ["Raydium", "Orca"]
      }
    ];
    return routes.filter(r => r.spreadPct > 0.0005); // show only >0.05% spreads
  }, [solUsd]);
};
