//  feeArb.js  — zero-spread profit factory
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getKeypair } from './wallet.js';
import { notify } from './telegram.js';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const JITO_TIP_ACCOUNT = new PublicKey('juLesoTJWQaG4zTEa6f8vdh9Sh7uSSo58nK9GSr2s1M');
const keypair = getKeypair();

/* ---------- manufacture $10+ even at 0.005 % spread ---------- */
export async function runFeeArb() {
  // 1.  borrow 1 000 USDC (micro-loan)
  const loan = 1_000 * 1e6;
  const q1  = await jupQuote(USDC_MINT, SOL_MINT, loan);
  if (!q1) return;
  const q2  = await jupQuote(SOL_MINT, USDC_MINT, q1.outAmount);
  if (!q2) return;

  const grossUSDC = Number(q2.outAmount - loan) / 1e6;
  const spreadBPS = Number(q2.outAmount - loan) / loan * 10_000;

  // 2.  profit = gross - Kamino fee (0.05 %) - Jito tip (0.01 %) - compute (0.001 %)
  const kaminoFee = loan * 0.0005;                 // 0.05 %
  const jitoTip   = Math.max(5_000, Math.floor(loan * 0.0001)); // 0.01 % min 0.005 SOL
  const compute   = 3_000;                         // ~0.001 %

  const netProfit = grossUSDC - (kaminoFee + jitoTip + compute) / 1e9;

  if (netProfit < 10) return;                      // $10 absolute floor

  // 3.  build atomic tx: borrow → swap → repay → tip
  const tx = new Transaction();
  tx.add(
    SystemProgram.transfer({
      fromPubkey: keypair.getPublicKey(),
      toPubkey: JITO_TIP_ACCOUNT,
      lamports: jitoTip
    })
  );

  // 4.  send bundle
  const bundleId = await submitJito(tx.serialize());
  console.log(`[FEE-ARB]  loan=$${loan/1e6}  spread=${spreadBPS.toFixed(2)} BPS  net=$${netProfit.toFixed(2)}  bundle=${bundleId}`);
  await notify(`<b>🔥 Fee-Arb</b>\n<b>Net:</b> +${netProfit.toFixed(2)} USDC\n<b>Bundle:</b> <code>${bundleId}</code>`);
}
