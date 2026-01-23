// event_listener.js
const { ethers } = require("ethers");
const { FACTORIES } = require("./factory_crawler");
require("dotenv").config();

const RPC_URL = process.env.RPC_URL || "https://base.llamarpc.com";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

/**
 * Listens for new pool creations across factories
 */
function startEventListener(onNewPool) {
    console.log("👂 Starting Real-Time Event Listener for new pools...");

    // Uniswap V2 Listener
    const uniV2Factory = new ethers.Contract(FACTORIES.UNISWAP_V2.address, FACTORIES.UNISWAP_V2.abi, provider);
    uniV2Factory.on("PairCreated", (token0, token1, pair, length) => {
        console.log(`✨ New Uniswap V2 Pool: ${token0} / ${token1} at ${pair}`);
        onNewPool({
            dex: "UNISWAP_V2",
            address: pair,
            token0: token0.toLowerCase(),
            token1: token1.toLowerCase(),
            type: "v2"
        });
    });

    // Aerodrome Listener
    const aeroFactory = new ethers.Contract(FACTORIES.AERODROME.address, FACTORIES.AERODROME.abi, provider);
    aeroFactory.on("PoolCreated", (token0, token1, stable, pool, length) => {
        console.log(`✨ New Aerodrome Pool: ${token0} / ${token1} (Stable: ${stable}) at ${pool}`);
        onNewPool({
            dex: "AERODROME",
            address: pool,
            token0: token0.toLowerCase(),
            token1: token1.toLowerCase(),
            type: "aerodrome",
            stable
        });
    });

    // Uniswap V3 Listener (Factory address is different for V3)
    const V3_FACTORY_ADDRESS = ethers.utils.getAddress("0x33128a8fc170d030b747a24199d40ac626abe82f".toLowerCase());
    const V3_FACTORY_ABI = ["event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"];
    const uniV3Factory = new ethers.Contract(V3_FACTORY_ADDRESS, V3_FACTORY_ABI, provider);
    uniV3Factory.on("PoolCreated", (token0, token1, fee, tickSpacing, pool) => {
        console.log(`✨ New Uniswap V3 Pool: ${token0} / ${token1} (Fee: ${fee}) at ${pool}`);
        onNewPool({
            dex: "UNISWAP_V3",
            address: pool,
            token0: token0.toLowerCase(),
            token1: token1.toLowerCase(),
            type: "v3",
            fee
        });
    });
}

module.exports = { startEventListener };
