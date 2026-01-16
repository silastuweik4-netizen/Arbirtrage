require('dotenv').config();
const express = require('express');
const cors = require('cors');
const ThreeWayScanner = require('./scanner3Way');

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

// Keep track of best opportunities for alerts
let bestOpportunities = new Map();
const ALERT_THRESHOLD_BP = 5; // Alert when opportunity > 5 bp

// Initialize 3-Way Scanner
async function initializeServices() {
  try {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://base-mainnet.g.alchemy.com';
    console.log(`\n📡 Using RPC: ${rpcUrl}`);
    
    scanner = new ThreeWayScanner();
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
      
      // Check for high-profit alerts
      const topNetBp = parseFloat(opportunities[0].netBp);
      const pairName = opportunities[0].pair;
      
      // Alert if this is a new opportunity or better than before
      if (!bestOpportunities.has(pairName) || topNetBp > bestOpportunities.get(pairName)) {
        bestOpportunities.set(pairName, topNetBp);
        
        if (topNetBp >= ALERT_THRESHOLD_BP) {
          console.log(`\n🚨 ALERT! High-profit opportunity detected!`);
          console.log(`   Pair: ${pairName}`);
          console.log(`   Net Profit: ${topNetBp} bp`);
          console.log(`   Per $100k: $${(topNetBp * 10).toFixed(0)}`);
          console.log(`   Per $1M: $${(topNetBp * 100).toFixed(0)}`);
          console.log(`   BUY: ${opportunities[0].buyDex} @ ${opportunities[0].buyPrice}`);
          console.log(`   SELL: ${opportunities[0].sellDex} @ ${opportunities[0].sellPrice}`);
          console.log(`   Timestamp: ${scannerStatus.lastScan}\n`);
        }
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

// Root
app.get('/', (req, res) => {
  res.json({
    name: '3-Way Arbitrage Scanner',
    version: '3.0.0',
    status: {
      autoScanning: scannerStatus.autoScanActive,
      scanCount: scannerStatus.scanCount,
      lastScan: scannerStatus.lastScan,
      topOpportunity: scannerStatus.topOpportunity
    },
    endpoints: {
      '/health': 'GET - Health check',
      '/api/status': 'GET - Scanner status',
      '/api/opportunities': 'GET - All current opportunities',
      '/api/scan': 'POST - Manual scan',
      '/api/top': 'GET - Top opportunity'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString() 
  });
});

// Status
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

// Get all opportunities
app.get('/api/opportunities', (req, res) => {
  const sorted = [...scannerStatus.opportunities].sort((a, b) => 
    parseFloat(b.netBp) - parseFloat(a.netBp)
  );

  res.json({
    opportunities: sorted,
    count: sorted.length,
    timestamp: new Date().toISOString()
  });
});

// Get top opportunity
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

// Manual scan
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
  console.log(`🚀 3-Way Arbitrage Scanner Server`);
  console.log(`${'='.repeat(80)}`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 Base URL: http://localhost:${PORT}`);
  console.log(`${'='.repeat(80)}\n`);

  await initializeServices();
  
  // Perform initial scan
  console.log('🔍 Running initial scan...\n');
  await performScan();

  // Start automatic scanning every 10 seconds
  scannerStatus.autoScanActive = true;
  console.log('⏱️  Auto-scanning enabled (every 10 seconds)');
  console.log('📊 Monitoring 20 pairs across 3 DEXes');
  console.log('🎯 Alert threshold: +5 bp profit\n');
  console.log(`${'='.repeat(80)}\n`);

  setInterval(async () => {
    await performScan();
  }, 10000); // Scan every 10 seconds
});

module.exports = app;
