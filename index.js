require('dotenv').config();
const { startArbLoop } = require('./arb');

const PORT = process.env.PORT || 10000;
require('http').createServer((req,res)=>{
  res.writeHead(200);
  res.end('Arb-bot alive');
}).listen(PORT, ()=>console.log(`Health-check on ${PORT}`));

startArbLoop();   // never returns
