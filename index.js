const { Connection, PublicKey } = require("@solana/web3.js");
const fetch = require("node-fetch");

// Environment variables
const OBLIGATION_ACCOUNTS = process.env.OBLIGATION_ACCOUNTS || "";
const LIQUIDATION_THRESHOLD = parseFloat(process.env.LIQUIDATION_THRESHOLD || "1.1");
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Parse obligation account public keys
const obligationPublicKeys = OBLIGATION_ACCOUNTS
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const connection = new Connection("https://api.mainnet-beta.solana.com");

// Function to send Telegram message
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Error sending Telegram message:", err);
  }
}

// Dummy parser - replace with actual layout based on Solend's data
function parseObligationData(dataBuffer) {
  if (dataBuffer.length < 16) {
    throw new Error("Data buffer too small");
  }
  const collateralValue = dataBuffer.readBigUInt64LE(0);
  const borrowedValue = dataBuffer.readBigUInt64LE(8);
  const collateralRatio = Number(collateralValue) / Number(borrowedValue);
  return {
    collateralRatio,
  };
}

// Check obligation for liquidation
async function checkObligation(obligationAddress) {
  try {
    const pubkey = new PublicKey(obligationAddress);
    const accountInfo = await connection.getAccountInfo(pubkey);
    if (!accountInfo || !accountInfo.data) {
      console.log(`No data for account: ${obligationAddress}`);
      return;
    }
    const dataBuffer = Buffer.from(accountInfo.data);
    const obligation = parseObligationData(dataBuffer);
    if (obligation.collateralRatio < LIQUIDATION_THRESHOLD) {
      const message = `🚨 Liquidation Alert!\nObligation: ${obligationAddress}\nCollateral Ratio: ${obligation.collateralRatio.toFixed(2)} (Threshold: ${LIQUIDATION_THRESHOLD})`;
      console.log(message);
      await sendTelegramMessage(message);
    } else {
      console.log(`Obligation ${obligationAddress} is safe. Ratio: ${obligation.collateralRatio.toFixed(2)}`);
    }
  } catch (err) {
    console.error(`Error checking obligation ${obligationAddress}:`, err);
  }
}

// Main function
async function main() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables");
    process.exit(1);
  }

  if (obligationPublicKeys.length === 0) {
    console.log("No obligation accounts provided. Set OBLIGATION_ACCOUNTS env variable.");
    return;
  }

  console.log("Starting Solend liquidation monitor...");
  for (const obligation of obligationPublicKeys) {
    await checkObligation(obligation);
  }

  // Run periodically
  setInterval(async () => {
    for (const obligation of obligationPublicKeys) {
      await checkObligation(obligation);
    }
  }, 60000); // check every 60 seconds
}

main();
