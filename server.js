require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const ArbitrageScanner = require('./scanner');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let scanner = null;
let scannerStatus = {
  isRunning: false,
  lastScan: null,
  opportunities: [],
  error: null
};

// Initialize scanner on startup
async function initializeScanner() {
  try {
    scanner = new ArbitrageScanner();
    await scanner.initialize();
    console.log('✅ Scanner initialized successfully');
  } catch (error) {
    console.error('❌ Scanner initialization failed:', error.message);
    scannerStatus.error = error.message;
  }
}

// Endpoint: Get scanner status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    scanner: scannerStatus,
    timestamp: new Date().toISOString()
  });
});

// Endpoint: Get current opportunities
app.get('/api/opportunities', (req, res) => {
  res.json({
    opportunities: scannerStatus.opportunities,
    count: scannerStatus.opportunities.length,
    timestamp: new Date().toISOString()
  });
});

// Endpoint: Start scanning
app.post('/api/scan', async (req, res) => {
  if (!scanner) {
    return res.status(400).json({ error: 'Scanner not initialized' });
  }

  try {
    scannerStatus.isRunning = true;
    const opportunities = await scanner.scanForArbitrageOpportunities();
    
    scannerStatus.opportunities = opportunities;
    scannerStatus.lastScan = new Date().toISOString();
    scannerStatus.error = null;

    res.json({
      success: true,
      opportunities,
      count: opportunities.length,
      timestamp: scannerStatus.lastScan
    });
  } catch (error) {
    scannerStatus.error = error.message;
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    scannerStatus.isRunning = false;
  }
});

// Endpoint: Get token info
app.get('/api/token/:address', async (req, res) => {
  if (!scanner) {
    return res.status(400).json({ error: 'Scanner not initialized' });
  }

  try {
    const tokenInfo = await scanner.getTokenInfo(req.params.address);
    res.json(tokenInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Arbitrage Scanner Bot',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      status: 'GET /api/status',
      opportunities: 'GET /api/opportunities',
      scan: 'POST /api/scan',
      tokenInfo: 'GET /api/token/:address'
    },
    baseUrl: process.env.BASE_URL || 'http://localhost:3000'
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initializeScanner();
  
  // Run initial scan
  if (scanner) {
    console.log('🔍 Running initial scan...');
    try {
      const opportunities = await scanner.scanForArbitrageOpportunities();
      scannerStatus.opportunities = opportunities;
      scannerStatus.lastScan = new Date().toISOString();
      console.log(`📊 Found ${opportunities.length} opportunities`);
    } catch (error) {
      console.error('❌ Initial scan failed:', error.message);
    }
  }
});

module.exports = app;
