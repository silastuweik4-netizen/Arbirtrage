import { useEffect, useState } from "react";
import axios from "axios";
import { JUP_API } from "../config";

type PriceResp = {
  data: Record<string, { price: number }>;
};

export const useJupiterPrices = (ids: string[] = ["SOL", "USDC"]) => {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    let active = true;
    const fetchPrices = async () => {
      try {
        const url = `${JUP_API.price}?ids=${ids.join(",")}`;
        const { data } = await axios.get<PriceResp>(url, { timeout: 8000 });
        if (!active) return;
        const map: Record<string, number> = {};
        Object.entries(data.data || {}).forEach(([k, v]) => (map[k] = v.price));
        setPrices(map);
        setUpdatedAt(new Date().toLocaleTimeString());
      } catch (err) {
        // fail-soft; keep old state
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 10_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [ids.join(",")]);

  return { prices, loading, updatedAt };
};
