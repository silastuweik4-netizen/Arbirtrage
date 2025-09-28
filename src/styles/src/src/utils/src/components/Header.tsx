import React from "react";

export const Header: React.FC = () => (
  <header className="px-6 py-4 bg-black text-white border-b border-gray-800">
    <div className="max-w-5xl mx-auto flex items-center justify-between">
      <h1 className="text-xl font-semibold">Solana Arbitrage Dashboard</h1>
      <span className="text-sm text-gray-400">Live spreads • Educational</span>
    </div>
  </header>
);
