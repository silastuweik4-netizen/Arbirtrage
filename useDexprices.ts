import { useEffect, useState } from "react";

export const useDexPrices = () => {
  const [prices, setPrices] = useState([]);

  useEffect(() => {
    fetch("https://quote-api.jup.ag/v6/price?ids=SOL")
      .then(res => res.json())
      .then(data => setPrices(data.data));
  }, []);

  return prices;
};
