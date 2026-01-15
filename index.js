#!/usr/bin/env node
require('dotenv').config();
const http = require('http');
const AeroDetector = require('./detector-aerodrome');

// keep Render alive
const server = http.createServer((_, res) => res.end('Aerodrome detector live\n'));
server.listen(process.env.PORT || 10000);

const detector = new AeroDetector();
detector.start().catch(console.error);
