// get-current-code.js
//
// Run this locally to see the CURRENT valid login code, so you can tell
// it to whoever you want to let into the chat.
//
// IMPORTANT: set the same SITE_SECRET here as you did on Render, e.g.:
//   SITE_SECRET=your-secret-here node get-current-code.js
//
// If you don't set SITE_SECRET, it falls back to the same insecure
// default as server.js — only useful for local testing.

const crypto = require('crypto');

const SITE_SECRET = process.env.SITE_SECRET || 'dev-only-change-me';
const TIME_STEP_SECONDS = 300;

function computeCode(secret, counter) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(String(counter));
  const digest = hmac.digest();
  const num = digest.readUInt32BE(0) % 1000000;
  return String(num).padStart(6, '0');
}

const counter = Math.floor(Date.now() / 1000 / TIME_STEP_SECONDS);
const code = computeCode(SITE_SECRET, counter);
const secondsLeft = TIME_STEP_SECONDS - (Math.floor(Date.now() / 1000) % TIME_STEP_SECONDS);

console.log(`Current code: ${code}`);
console.log(`Valid for another ${secondsLeft} seconds.`);
