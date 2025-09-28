import React from "react";
import cn from "classnames";
import { fmtPct, fmtUsd } from "../utils/format";

type Props = {
  dexA: string;
  dexB: string;
  token: string;
  spreadPct: number;
  estProfitUsd: number;
  route: string[];
  updatedAt?: string;
};

export const RouteCard: React.FC<Props> = ({
  dexA,
  dexB,
  token,
  spreadPct,
  estProfitUsd,
  route,
  updatedAt
}) => {
  const profitable = spreadPct > 0;
  return (
    <div
      className={cn(
        "p-4 rounded-xl border shadow-sm transition",
        profitable ? "border-emerald-500 bg-white" : "border-gray-200 bg-white"
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{token}</h2>
        <span
          className={cn(
            "text-sm px-2 py-1 rounded",
            profitable ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
          )}
        >
          {profitable ? "Opportunity" : "No spread"}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-600">{dexA} → {dexB}</p>
      <div className="mt-3 flex items-center gap-4">
        <div className="text-gray-800">
          <div className="text-xs uppercase tracking-wide text-gray-500">Spread</div>
          <div className={cn("font-semibold", profitable ? "text-emerald-700" : "text-gray-700")}>
            {fmtPct(spreadPct)}
          </div>
        </div>
        <div className="text-gray-800">
          <div className="text-xs uppercase tracking-wide text-gray-500">Est. profit</div>
          <div className={cn("font-semibold", profitable ? "text-emerald-700" : "text-gray-700")}>
            {fmtUsd(estProfitUsd)}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500">Route: {route.join(" → ")}</p>
      {updatedAt && <p className="mt-2 text-xs text-gray-400">Updated: {updatedAt}</p>}
    </div>
  );
};
