import React from "react";
import { RouteCard } from "./components/RouteCard";
import { useDexPrices } from "./hooks/useDexPrices";

function App() {
  const prices = useDexPrices();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Solana Arbitrage Dashboard</h1>
      {prices.length > 0 && (
        <RouteCard
          dexA="Raydium"
          dexB="Orca"
          token="SOL/USDC"
          profit="0.7%"
          route={["Raydium", "Orca"]}
        />
      )}
    </div>
  );
}

export default App;
