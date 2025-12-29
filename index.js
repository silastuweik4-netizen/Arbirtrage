/*  index.js  –  Application entry point with graceful shutdown  */
require('dotenv').config();
const http = require('http');

// Import both start and stop functions from our arb module
const { startArbLoop, stopArbLoop } = require('./arb');

const PORT = process.env.PORT || 10000;

// --- Graceful Shutdown Logic ---
const gracefulShutdown = (signal) => {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  
  // 1. Stop the arbitrage scanning loop
  stopArbLoop();

  // 2. Close the HTTP server. This stops accepting new connections.
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0); // Exit with a success code
  });

  // Force close after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Listen for shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Sent by deployment platforms
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Sent by Ctrl+C

// --- Top-Level Error Handling ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // It's often safest to exit the process on an unhandled rejection
  // after logging, as the application might be in an unknown state.
  gracefulShutdown('unhandledRejection');
});

// --- Start the Application ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Arb-bot alive');
});

server.listen(PORT, () => {
  console.log(`Health-check server listening on port ${PORT}`);
  console.log('Starting main application logic...');
  startArbLoop(); // This starts the infinite scan loop
});
