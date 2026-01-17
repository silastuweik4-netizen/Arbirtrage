require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WorkingArbitrageScanner = require('./scanner-working');

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
    console.log(`\n📡 Using RPC: ${rpcUrl}`);
    
    scanner = new WorkingArbitrageScanner();
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

    // Find top opportunity
    if (opportunities.length > 0) {
      scannerStatus.topOpportunity = opportunities[0];
      
      // Alert on high-profit opportunities
      const topProfit = parseFloat(opportunities[0].netProfit);
      if (topProfit >= 3) {
        console.log(`\n🚨 ALERT! Profitable opportunity detected!`);
        console.log(`   Pair: ${opportunities[0].pair}`);
        console.log(`   Spread: ${opportunities[0].spreadBp} bp`);
        console.log(`   Net Profit: ${opportunities[0].netProfit} bp`);
        console.log(`   BUY: ${opportunities[0].buyDex} → SELL: ${opportunities[0].sellDex}\n`);
      }
    }

  } catch (error) {
    scannerStatus.error = error.message;
    console.error('❌ Scan error:', error.message);
  } finally {
    scannerStatus.isRunning = false;
  }
}

// ============== API ENDPOINTS ==============

app.get('/', (req, res) => {
  res.json({
    name: 'Direct Pool Arbitrage Scanner',
    version: '3.1.0',
    status: {
      autoScanning: scannerStatus.autoScanActive,
      scanCount: scannerStatus.scanCount,
      lastScan: scannerStatus.lastScan,
      topOpportunity: scannerStatus.topOpportunity
    },
    endpoints: {
      '/health': 'GET - Health check',
      '/api/status': 'GET - Scanner status',
      '/api/opportunities': 'GET - All opportunities',
      '/api/scan': 'POST - Manual scan',
      '/api/top': 'GET - Top opportunity'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    autoScanning: scannerStatus.autoScanActive,
    scanCount: scannerStatus.scanCount,
    lastScan: scannerStatus.lastScan,
    lastScanDuration: `${scannerStatus.lastScanDuration}ms`,
    opportunitiesFound: scannerStatus.opportunities.length,
    topOpportunity: scannerStatus.topOpportunity,
    error: scannerStatus.error,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/opportunities', (req, res) => {
  const sorted = [...scannerStatus.opportunities].sort((a, b) => 
    parseFloat(b.netProfit) - parseFloat(a.netProfit)
  );

  res.json({
    opportunities: sorted,
    count: sorted.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/top', (req, res) => {
  if (!scannerStatus.topOpportunity) {
    return res.json({ 
      opportunity: null, 
      message: 'No opportunities found yet',
      timestamp: new Date().toISOString()
    });
  }

  res.json({
    opportunity: scannerStatus.topOpportunity,
    timestamp: new Date().toISOString()
  });
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
    topOpportunity: scannerStatus.topOpportunity,
    duration: `${scannerStatus.lastScanDuration}ms`,
    timestamp: scannerStatus.lastScan
  });
});

// ============== START SERVER ==============

app.listen(PORT, async () => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 Direct Pool Arbitrage Scanner`);
  console.log(`${'='.repeat(80)}`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`${'='.repeat(80)}\n`);

  await initializeServices();
  
  console.log('🔍 Running initial scan...\n');
  await performScan();

  scannerStatus.autoScanActive = true;
  console.log('⏱️  Auto-scanning enabled (every 15 seconds)');
  console.log(`${'='.repeat(80)}\n`);

  setInterval(async () => {
    await performScan();
  }, 15000);
});

module.exports = app;
