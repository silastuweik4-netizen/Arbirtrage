// detect.js
import { fetch } from 'undici';

const SOL_USDC_MINT = 'So11111111111111111111111111111111111111112_EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function raydiumPrice() {
  const res = await fetch(
    `https://api-v2.raydium.io/v2/ammV3/mint/price?mint=${SOL_USDC_MINT}`
  );
  const { data } = await res.json();
  return parseFloat(data.value); // USDC per SOL
}

async function orcaPrice() {
  const res = await fetch(
    `https://api-v2.raydium.io/v2/ammV3/mint/price?mint=${SOL_USDC_MINT}&poolSource=orca`
  );
  const { data } = await res.json();
  return parseFloat(data.value); // USDC per SOL
}

setInterval(async () => {
  try {
    const [ray, orc] = await Promise.all([raydiumPrice(), orcaPrice()]);
    const spread = Math.abs(ray - orc) * 1e9; // lamports per SOL
    console.log(
      new Date().toISOString(),
      'Raydium', ray.toFixed(6),
      'Orca', orc.toFixed(6),
      'Spread (lamports)', spread.toFixed(0)
    );
  } catch (e) {
    console.error('Poll error', e.message);
  }
}, 10_000);
