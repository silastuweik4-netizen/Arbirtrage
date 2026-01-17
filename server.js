require('dotenv').config();
const express = require('express');
const cors = require('cors');
const ArbitrageScanner = require('./scanner');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let scanner = null;
let scannerStatus = {
  isRunning: false,
  lastScan: null,
  lastScanDuration: 0,
  opportunities: [],
  topOpportunity: null,
  scanCount: 0,
  autoScanActive: false,
  error: null
};

// Initialize Scanner
async function initializeServices() {
  try {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
    console.log(`📡 Using RPC: ${rpcUrl}`);
    
    scanner = new ArbitrageScanner();
    await scanner.initialize();
    console.log('✅ Scanner initialized successfully\n');

  } catch (error) {
    console.error('❌ Service initialization failed:', error.message);
    scannerStatus.error = error.message;
  }
}

// Perform a scan
async function performScan() {
  if (!scanner || scannerStatus.isRunning) {
    return;
  }

  try {
    scannerStatus.isRunning = true;
    const startTime = Date.now();
    
    const opportunities = await scanner.scanForArbitrageOpportunities();
    const duration = Date.now() - startTime;
    
    scannerStatus.opportunities = opportunities;
    scannerStatus.lastScan = new Date().toISOString();
    scannerStatus.lastScanDuration = duration;
    scannerStatus.scanCount++;
    scannerStatus.error = null;

    if (opportunities.length > 0) {
      scannerStatus.topOpportunity = opportunities[0];
      const topProfit = parseFloat(opportunities[0].netProfit);
      if (topProfit >= 3) {
        console.log(`\n🚨 ALERT! Profitable opportunity found!\n`);
      }
    }

  } catch (error) {
    scannerStatus.error = error.message;
    console.error('❌ Scan error:', error.message);
  } finally {
    scannerStatus.isRunning = false;
  }
}

// API Routes
app.get('/', (req, res) => {
  res.json({
    name: 'Arbitrage Scanner Bot',
    version: '1.0.0',
    status: scannerStatus,
    endpoints: {
      '/health': 'GET',
      '/api/status': 'GET',
      '/api/opportunities': 'GET',
      '/api/scan': 'POST'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({
    ...scannerStatus,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/opportunities', (req, res) => {
  const sorted = [...scannerStatus.opportunities].sort((a, b) => 
    parseFloat(b.netProfit) - parseFloat(a.netProfit)
  );
  res.json({ opportunities: sorted, count: sorted.length });
});

app.post('/api/scan', async (req, res) => {
  if (!scanner) {
    return res.status(400).json({ error: 'Scanner not initialized' });
  }
  await performScan();
  res.json({
    success: true,
    opportunities: scannerStatus.opportunities,
    count: scannerStatus.opportunities.length,
    duration: `${scannerStatus.lastScanDuration}ms`
  });
});

// Start Server
app.listen(PORT, async () => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 Arbitrage Scanner Bot`);
  console.log(`${'='.repeat(80)}\n`);

  await initializeServices();
  await performScan();

  scannerStatus.autoScanActive = true;
  console.log('⏱️  Auto-scanning enabled (every 15 seconds)\n');
  console.log(`${'='.repeat(80)}\n`);

  setInterval(async () => {
    await performScan();
  }, 15000);
});

module.exports = app;
