import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { KaminoMarket, KaminoObligation } from '@kamino-finance/klend-sdk';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { BN } from 'bn.js';
import fetch from 'node-fetch';

const KAMINO_MAIN_MARKET_ID = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');
const KAMINO_PROGRAM_ID_PK = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmj6');

// **FIXED GITHUB RAW URL**
const KAMINO_IDL_URL = 'https://raw.githubusercontent.com/silastuweik4-netizen/Arbirtrage/main/klend.json';

export class KaminoProtocol {
  constructor() {
    this.name = 'Kamino';
    this.programId = KAMINO_PROGRAM_ID_PK;
    this.market = null;
    this.coder = null;
    this.obligationAccountSize = 2000;
  }

  async initialize(connection) {
    console.log(`Fetching IDL for Kamino from: ${KAMINO_IDL_URL}`);
    try {
      const idl = await fetch(KAMINO_IDL_URL).then(res => res.json());
      this.coder = new BorshAccountsCoder(idl);
    } catch (e) {
      console.error(`Failed to fetch Kamino IDL from ${KAMINO_IDL_URL}:`, e);
      throw e;
    }

    this.market = await KaminoMarket.load(connection, KAMINO_MAIN_MARKET_ID);
  }

  async getObligationAccounts(connection) {
    const accounts = await connection.getProgramAccounts(this.programId, {
      filters: [{ dataSize: this.obligationAccountSize }],
    });
    return accounts.map(a => ({ pubkey: a.pubkey, programId: this.programId }));
  }

  async getHealthFactor(pubkey, accountInfo) {
    if (!this.market || !this.coder) {
      throw new Error('Kamino protocol not initialized');
    }
    const decodedObligation = this.coder.decode('obligation', accountInfo.data);
    const kaminoObligation = new KaminoObligation(this.programId, decodedObligation, this.market);
    const { borrowLimit, liquidationThreshold } = kaminoObligation.getBorrowLimitAndThreshold();
    if (borrowLimit.isZero()) return 999.99;
    return liquidationThreshold.muln(100).div(borrowLimit).toNumber();
  }
}
