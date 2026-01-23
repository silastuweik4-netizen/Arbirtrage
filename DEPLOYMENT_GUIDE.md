# Deployment Guide: Arbitrage Bot on Render

This guide provides step-by-step instructions for deploying the Base Chain Arbitrage Bot on Render's free tier.

## Prerequisites

1. **GitHub Account** - The repository must be pushed to GitHub
2. **Render Account** - Sign up at [render.com](https://render.com)
3. **Base Chain RPC Endpoint** - Get a free endpoint from:
   - [Infura](https://infura.io) (free tier available)
   - [Alchemy](https://alchemy.com) (free tier available)
   - [Base Public RPC](https://mainnet.base.org) (rate limited)
4. **Wallet Private Key** (optional, for flashloan execution)
5. **Deployed Flashloan Contract Address** (optional, for flashloan execution)

## Step 1: Prepare Your Repository

### 1.1 Update Environment Variables

Create a `.env` file locally (do NOT commit to GitHub):

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
RPC_URL=https://mainnet.base.org
PRICE_DIFFERENCE_THRESHOLD=0.5
CHECK_INTERVAL_MS=10000
TRADE_SIZE=1
MIN_LIQUIDITY_USD=1000
WEBHOOK_URL=  # Optional: Discord/Slack webhook
PRIVATE_KEY=  # Optional: Your wallet private key
FLASHLOAN_CONTRACT_ADDRESS=  # Optional: Your deployed contract
GAS_LIMIT=500000
PORT=3000
```

### 1.2 Ensure .env is in .gitignore

```bash
echo ".env" >> .gitignore
git add .gitignore
git commit -m "Add .env to gitignore"
```

### 1.3 Push to GitHub

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

## Step 2: Deploy on Render

### 2.1 Connect GitHub Repository

1. Go to [render.com](https://render.com) and sign in
2. Click **New +** → **Web Service**
3. Select **Connect a repository**
4. Authorize GitHub and select your `Arbirtrage` repository
5. Click **Connect**

### 2.2 Configure the Web Service

Fill in the following details:

| Field | Value |
|-------|-------|
| **Name** | `arbitrage-bot` |
| **Environment** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Plan** | `Free` |

### 2.3 Add Environment Variables

Click **Advanced** and add the following environment variables:

| Key | Value |
|-----|-------|
| `RPC_URL` | `https://mainnet.base.org` (or your preferred RPC) |
| `PRICE_DIFFERENCE_THRESHOLD` | `0.5` |
| `CHECK_INTERVAL_MS` | `10000` |
| `TRADE_SIZE` | `1` |
| `MIN_LIQUIDITY_USD` | `1000` |
| `PORT` | `3000` |
| `WEBHOOK_URL` | (Leave empty or add your Discord/Slack webhook) |
| `PRIVATE_KEY` | (Leave empty unless you're using flashloan execution) |
| `FLASHLOAN_CONTRACT_ADDRESS` | (Leave empty unless you're using flashloan execution) |
| `GAS_LIMIT` | `500000` |

### 2.4 Deploy

Click **Create Web Service** and Render will automatically:
1. Clone your repository
2. Install dependencies (`npm install`)
3. Start the bot (`npm start`)

The deployment should complete in 2-5 minutes.

## Step 3: Verify Deployment

### 3.1 Check Service Status

1. Go to your Render dashboard
2. Click on the `arbitrage-bot` service
3. Check the **Logs** tab for output

You should see:
```
Health check server on port 3000
[ISO-TIMESTAMP] Scanning X pairs (dynamic + explicit VIRTUAL + explicit AERO) & Y triangular routes...
```

### 3.2 Test Health Check

Visit your service URL (e.g., `https://arbitrage-bot-xxxxx.onrender.com/`) in a browser. You should see:

```
Arbitrage Bot running: Detection and Flashloan Execution enabled.
```

## Step 4: Configure Flashloan Execution (Optional)

If you have a deployed flashloan contract on Base Chain:

### 4.1 Update Environment Variables

In the Render dashboard:

1. Click **Environment** on your service
2. Add/update these variables:
   - `PRIVATE_KEY`: Your wallet's private key (hex format: `0x...`)
   - `FLASHLOAN_CONTRACT_ADDRESS`: Your deployed contract address (hex format: `0x...`)
   - `GAS_LIMIT`: Adjust if needed (default: `500000`)

### 4.2 Important Security Notes

⚠️ **CRITICAL**: 
- **Never** commit your private key to GitHub
- Render environment variables are encrypted at rest
- Use a dedicated wallet with limited funds for testing
- Monitor your wallet balance regularly
- Test thoroughly on a testnet first

## Step 5: Monitor Your Bot

### 5.1 View Logs

1. Go to your Render service dashboard
2. Click **Logs** to see real-time output
3. Look for:
   - `🔍 Potential opportunity` - Detected a spread
   - `🎯 VERIFIED` - Confirmed arbitrage opportunity
   - `⚡️ Attempting Flashloan Execution` - Trade being executed
   - `❌` - Errors or dropped opportunities

### 5.2 Webhook Alerts

If you configured a Discord/Slack webhook:
- Opportunities will be posted to your channel
- Format: `🎯 VERIFIED: TOKEN_PAIR | Profit=X.XX% | ...`

### 5.3 Health Checks

Render automatically pings your service every 10 minutes. If it doesn't respond:
- Service will be restarted automatically
- Check logs for errors

## Step 6: Troubleshooting

### Issue: Service keeps restarting

**Causes:**
- RPC endpoint is down or rate-limited
- Missing environment variables
- Node.js version incompatibility

**Solutions:**
1. Check logs for error messages
2. Verify all required environment variables are set
3. Try a different RPC provider (Alchemy or Infura)
4. Ensure Node.js version is ≥16.0.0

### Issue: No opportunities found

**This is normal!** Arbitrage opportunities are rare. To increase detection:

1. Lower `PRICE_DIFFERENCE_THRESHOLD` to `0.1` or `0.2`
2. Decrease `CHECK_INTERVAL_MS` to `5000` (5 seconds)
3. Lower `MIN_LIQUIDITY_USD` to `500`
4. Add more token pairs in `detector.js`
5. Use a faster RPC endpoint (Alchemy or Infura)

### Issue: Flashloan execution fails

**Possible causes:**
- Insufficient balance in wallet
- Contract address is incorrect
- Contract ABI doesn't match actual contract
- Gas limit too low
- Network congestion

**Solutions:**
1. Verify contract address on [Basescan](https://basescan.org)
2. Check wallet balance
3. Increase `GAS_LIMIT` to `1000000`
4. Provide the correct contract ABI (update `FLASHLOAN_ABI` in `detector.js`)

## Step 7: Advanced Configuration

### 7.1 Custom Token Pairs

Edit `detector.js` and modify the `TOKENS` object:

```javascript
const TOKENS = {
  WETH: { address: '0x4200...', name: 'WETH', decimals: 18 },
  USDC: { address: '0x8335...', name: 'USDC', decimals: 6 },
  // Add your custom tokens here
  CUSTOM: { address: '0x...', name: 'CUSTOM', decimals: 18 },
};
```

### 7.2 Custom DEX Pools

Add explicit pools to `VIRTUAL_POOLS` or `AERO_POOLS`:

```javascript
const CUSTOM_POOLS = [
  { dex: 'uniswap_v3', pairAddress: '0x...', token0: TOKENS.CUSTOM, token1: TOKENS.WETH, meta: { feeTiers: [100, 500, 3000, 10000] } },
];
```

### 7.3 Redeploy After Changes

```bash
git add .
git commit -m "Update token pairs and pools"
git push origin main
```

Render will automatically redeploy your service.

## Step 8: Production Best Practices

1. **Use a dedicated wallet** - Don't use your main wallet
2. **Start with small amounts** - Test with minimal capital
3. **Monitor gas costs** - They can exceed profits
4. **Set up alerts** - Use Discord/Slack webhooks
5. **Regular backups** - Keep a backup of your configuration
6. **Test on testnet first** - Use Base Sepolia testnet before mainnet
7. **Keep logs** - Archive logs for analysis

## Useful Links

- [Render Documentation](https://render.com/docs)
- [Base Chain Documentation](https://docs.base.org)
- [Basescan Explorer](https://basescan.org)
- [Uniswap V3 Docs](https://docs.uniswap.org)
- [Aerodrome Finance](https://aerodrome.finance)

## Support

For issues:
1. Check the **Troubleshooting** section above
2. Review logs in the Render dashboard
3. Verify contract addresses on Basescan
4. Test RPC connection locally with `curl`

---

**Built with ❤️ for the Base Chain DeFi community**
