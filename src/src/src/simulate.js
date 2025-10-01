import axios from 'axios';

export async function simulateProfit(candidate) {
  const repayAmount = 1000; // USDC
  const bonus = 0.08; // 8% liquidation bonus

  // Estimate seized collateral
  const seizedValue = repayAmount * (1 + bonus);

  // Cross-check via Jupiter quote
  const { data } = await axios.get(
    `https://quote-api.jup.ag/v6/quote?inputMint=${candidate.liquidityToken}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${repayAmount * 1e6}`
  );

  const outAmount = data?.outAmount / 1e6 || 0;
  return outAmount - repayAmount;
}
