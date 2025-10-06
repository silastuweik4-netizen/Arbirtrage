import { executeOne } from './oneShot.js';
import { config } from 'dotenv'; config();

// execute the exact mint from the trending ping
const MINT = '6vVfbQVRSXcfyQamPqCzcqmA86vCzb2d7B7gmDDqpump'; // copy from Telegram
executeOne(MINT, 1_000_000).catch(e => console.log('One-shot crash', e));
