/**
 * VoiceCare share-link store
 *
 * A doctor opens a QR link with no login, so the link itself is the credential:
 * - 144-bit random token (guessable only by brute force)
 * - expires after 24 hours
 * - read-only snapshot of one summary
 *
 * Records are kept in a JSON file next to the backend so a restart does not
 * break links that are already printed on a prescription. On hosts with an
 * ephemeral disk (Render free tier) a redeploy clears them; the app regenerates
 * a link whenever the patient asks again.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const DATA_DIR = process.env.SHARE_DATA_DIR || path.join(__dirname, '..', '.data');
const FILE = path.join(DATA_DIR, 'shares.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache), 'utf8');
  } catch (error) {
    console.warn('[VoiceCare Share] Could not persist share links:', error.message);
  }
}

/** Drops expired records so the file cannot grow forever. */
function prune() {
  const list = load();
  const now = Date.now();
  const kept = list.filter((item) => item && Number(item.expiresAt) > now);
  if (kept.length !== list.length) {
    cache = kept;
    persist();
  }
  return cache;
}

/**
 * Creates a share token for a summary snapshot.
 * @param {Record<string, unknown>} snapshot
 * @returns {{ token: string, expiresAt: string }}
 */
function createShare(snapshot) {
  prune();
  const now = Date.now();
  const record = {
    token: crypto.randomBytes(18).toString('base64url'),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + TTL_MS,
    data: snapshot
  };

  cache.unshift(record);
  if (cache.length > MAX_ENTRIES) cache = cache.slice(0, MAX_ENTRIES);
  persist();

  return {
    token: record.token,
    expiresAt: new Date(record.expiresAt).toISOString()
  };
}

/**
 * Reads a share link.
 * @param {string} token
 * @returns {{ status: 'ok', data: Record<string, unknown>, expiresAt: string } | { status: 'missing' } | { status: 'expired' }}
 */
function getShare(token) {
  if (typeof token !== 'string' || token.length < 8) return { status: 'missing' };
  prune();

  const record = load().find((item) => item.token === token);
  if (!record) return { status: 'missing' };
  if (Number(record.expiresAt) <= Date.now()) return { status: 'expired' };

  return {
    status: 'ok',
    data: record.data,
    expiresAt: new Date(record.expiresAt).toISOString()
  };
}

module.exports = {
  TTL_MS,
  createShare,
  getShare
};
