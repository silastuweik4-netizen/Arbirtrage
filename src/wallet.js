import crypto from 'crypto';
import { config } from 'dotenv'; config();
const ALGO = 'aes-256-cbc';
export function decryptKey() {
  const [ct, iv] = process.env.PRIV_KEY_CIPHER.split(':');
  const pwd = process.env.PRIV_KEY_PASSWORD || 'default';
  const decipher = crypto.createDecipheriv(ALGO, crypto.scryptSync(pwd, 'salt', 32), Buffer.from(iv, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(ct, 'hex')), decipher.final()]);
  return JSON.parse(dec.toString()); // array
}
