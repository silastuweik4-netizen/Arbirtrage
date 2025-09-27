import React from "react";

export const RouteCard = ({ dexA, dexB, token, profit, route }) => (
  <div className="p-4 border rounded-lg shadow-md bg-white">
    <h2 className="text-lg font-bold">{token}</h2>
    <p>{dexA} → {dexB}</p>
    <p className="text-green-600 font-semibold">Profit: {profit}</p>
    <p className="text-sm text-gray-500">Route: {route.join(" → ")}</p>
  </div>
);
