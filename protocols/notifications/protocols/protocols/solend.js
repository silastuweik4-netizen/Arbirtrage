import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { SolendMarket, SolendObligation } from '@solendprotocol/solend-sdk';
import { LENDING_PROGRAM_ID as SOLEND_PROGRAM_ID_SDK } from '@solendprotocol/solend-sdk/dist/lib/constants';

export class SolendProtocol {
  constructor() {
    this.name = 'Solend';
    this.programId = SOLEND_PROGRAM_ID_SDK;
    this.market = null; // Will store the initialized SolendMarket
    this.obligationAccountSize = 1300; // Approximate size for filtering
  }

  async initialize(connection: Connection) {
    // Solend client initialization
    // Needs to fetch the market to get context for health calculations
    this.market = await SolendMarket.initialize(connection, 'mainnet-beta');
  }

  // Gets a list of all current obligation account public keys and their programId
  async getObligationAccounts(connection: Connection): Promise<{ pubkey: PublicKey, programId: PublicKey }[]> {
    const accounts = await connection.getProgramAccounts(this.programId, {
      filters: [{ dataSize: this.obligationAccountSize }],
    });
    return accounts.map(a => ({ pubkey: a.pubkey, programId: this.programId }));
  }

  // Decodes account data and calculates health factor
  async getHealthFactor(pubkey: PublicKey, accountInfo: AccountInfo<Buffer>): Promise<number> {
    if (!this.market) {
      throw new Error('SolendMarket not initialized');
    }

    // Solend's SDK allows decoding an obligation from raw account data
    const obligation = SolendObligation.decode(this.programId, pubkey, accountInfo);

    // Refresh market prices and data periodically in `initialize` or a dedicated update cycle
    // For real-time, you might need to ensure `this.market` is updated with latest oracle prices.
    // For simplicity, we use the obligation's current stats derived from its internal data.
    if (!obligation?.stats?.collateralRatio) return 999.99; // Indicate very healthy or an issue
    return parseFloat((obligation.stats.collateralRatio * 100).toFixed(2));
  }
}
