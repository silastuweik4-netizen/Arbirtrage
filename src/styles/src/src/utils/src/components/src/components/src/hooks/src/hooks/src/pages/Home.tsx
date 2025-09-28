import React from "react";
import { useJupiterPrices } from "../hooks/useJupiterPrices";
import { useArbRoutes } from "../hooks/useArbRoutes";
import { RouteCard } from "../components/RouteCard";

export const Home: React.FC = () => {
  const { prices, loading, updatedAt } = useJupiterPrices(["SOL", "USDC"]);
  const solUsd = prices["SOL"];
  const routes = useArbRoutes(solUsd);

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Live opportunities</h2>
        <p className="text-sm text-gray-600">
          Data via Jupiter. Demo routes inferred; production would simulate exact AMM paths.
        </p>
      </div>

      {loading && <p className="text-gray-500">Loading prices…</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {routes.map((r, i) => (
          <RouteCard
            key={i}
            dexA={r.dexA}
            dexB={r.dexB}
            token={r.token}
            spreadPct={r.spreadPct}
            estProfitUsd={r.estProfitUsd}
            route={r.route}
            updatedAt={updatedAt}
          />
        ))}
      </div>

      {!loading && routes.length === 0 && (
        <p className="text-gray-500 mt-4">
          No profitable spreads detected at the moment. Check back soon.
        </p>
      )}
    </main>
  );
};
