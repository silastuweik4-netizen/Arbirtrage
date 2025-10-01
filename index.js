import 'dotenv/config';               // Render injects env vars automatically
import express from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { SolendMarket } from '@solendprotocol/solend-sdk';
import { KaminoMarket } from '@kamino-finance/klend-sdk';
import { MarginfiClient, getConfig } from '@mrgnlabs/marginfi-client-v2';
import { NodeWallet } from '@mrgnlabs/mrgn-common';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import fetch from 'node-fetch';

import marginfiIdl from './marginfi-v2.json' assert { type: 'json' };

const app = express();
const PORT = process.env.PORT || 10000;

const LENDING_PROGRAM_IDS = [
  new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'),
  new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmj6'),
  new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA')
];
const PROTOCOL_NAMES = new Map(LENDING_PROGRAM_IDS.map(p => [p.toBase58(), p.equals(LENDING_PROGRAM_IDS[0]) ? 'Solend' : p.equals(LENDING_PROGRAM_IDS[1]) ? 'Kamino' : 'Marginfi']));
const OBLIGATION_SIZES = new Map(LENDING_PROGRAM_IDS.map(p => [p.toBase58(), p.equals(LENDING_PROGRAM_IDS[0]) ? 1300 : p.equals(LENDING_PROGRAM_IDS[1]) ? 2000 : 3928]));

const THRESHOLD = 105;
const clients = new Map();
const subs = new Map();
let cxn;

async function telegram(text) {
  const tok = process.env.TELEGRAM_BOT_TOKEN;
  const cid = process.env.TELEGRAM_CHAT_ID;
  if (!tok || !cid) return;
  await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cid, text, parse_mode: 'Markdown' })
  });
}

async function healthCheck(pubkey, program) {
  const id = program.toBase58(), name = PROTOCOL_NAMES.get(id);
  let hp;
  try {
    const info = await cxn.getAccountInfo(pubkey);
    if (!info) return;
    if (program.equals(LENDING_PROGRAM_IDS[0])) {
      const ob = await clients.get(id).getObligationByAddress(pubkey);
      hp = (ob.stats.collateralRatio * 100).toFixed(2);
    } else if (program.equals(LENDING_PROGRAM_IDS[1])) {
      const ob = clients.get(id).getObligation(pubkey, info.data);
      const { borrowLimit, liquidationThreshold } = ob.getBorrowLimitAndThreshold();
      hp = borrowLimit.isZero() ? 999 : liquidationThreshold.muln(100).div(borrowLimit).toNumber() / 100;
    } else {
      const coder = new BorshAccountsCoder(marginfiIdl);
      const acc = coder.decode('MarginfiAccount', info.data);
      const mfi = new (clients.get(id))._program.account.MarginfiAccount(acc);
      const { liabilities } = mfi.getAssetsAndLiabilities();
      if (liabilities.isZero()) hp = 999;
      else {
        const { healthFactor, liquidationThreshold } = mfi.getHealth();
        hp = healthFactor.muln(100).div(liquidationThreshold).toNumber() / 100;
      }
    }
    console.log(`🏥 ${name} ${pubkey.toBase58()} ${hp}%`);
    if (hp < THRESHOLD) await telegram(`🚨 Liquidation Alert\\nProtocol: ${name}\\nObligation: \\`${pubkey.toBase58()}\\`\\nHealth: ${hp}%`);
  } catch (e) { console.error(`❌ health ${name}`, e.message); }
}

async function discover() {
  for (const pid of LENDING_PROGRAM_IDS) {
    const id = pid.toBase58();
    const accts = await cxn.getProgramAccounts(pid, { filters: [{ dataSize: OBLIGATION_SIZES.get(id) }] });
    console.log(`✅ ${PROTOCOL_NAMES.get(id)}: ${accts.length} obligations`);
    for (const { pubkey } of accts) {
      if (!subs.has(pubkey.toBase58())) {
        const sub = cxn.onAccountChange(pubkey, () => healthCheck(pubkey, pid), 'confirmed');
        subs.set(pubkey.toBase58(), sub);
      }
    }
  }
}

async function start() {
  cxn = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
  clients.set(LENDING_PROGRAM_IDS[0].toBase58(), await SolendMarket.initialize(cxn, 'mainnet-beta'));
  clients.set(LENDING_PROGRAM_IDS[1].toBase58(), await KaminoMarket.load(cxn, new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF')));
  const wallet = new NodeWallet(Keypair.generate());
  clients.set(LENDING_PROGRAM_IDS[2].toBase58(), await MarginfiClient.fetch(getConfig('production'), wallet, cxn));
  await discover();
  cxn.onLogs({ mentions: LENDING_PROGRAM_IDS }, (rl) => {
    if (rl.err) return;
    for (const a of rl.mentions) if (subs.has(a.toBase58())) healthCheck(a, rl.source);
  }, 'confirmed');
}

app.get('/health', (_, r) => r.sendStatus(200));
app.get('/status', (_, r) => r.json({ solana: 'connected', obligations: subs.size }));

await start();
app.listen(PORT, () => console.log(`⚡️ Bot on port ${PORT}`));
