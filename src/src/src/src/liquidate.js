import { Transaction } from '@solana/web3.js';
import { SolendMarket } from '@solendprotocol/solend-sdk';

export async function liquidate(connection, wallet, candidate) {
  const market = await SolendMarket.initialize(connection, 'mainnet');
  const tx = new Transaction();

  // Build liquidation instruction
  const ix = market.makeLiquidateObligationInstruction({
    obligation: candidate.obligation,
    repayMint: candidate.liquidityToken,
    withdrawMint: candidate.collateralMint,
    repayAmount: 1_000_000, // 1000 USDC
    user: wallet.publicKey,
  });

  tx.add(ix);
  const sig = await connection.sendTransaction(tx, [wallet]);
  console.log("Liquidation sent:", sig);
}
