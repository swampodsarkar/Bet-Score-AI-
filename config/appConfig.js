const { getDB } = require('./firebase');

const CONFIG_KEYS = [
  'PAYMENT_METHOD', 'PAYMENT_NUMBER', 'PAYMENT_INSTRUCTIONS',
  'MIN_DEPOSIT', 'DEFAULT_STARTING_COINS', 'ADMIN_USER_IDS',
  'ADMIN_API_TOKEN', 'ADMIN_EMAIL', 'ADMIN_PASS'
];

let configCache = null;

async function loadConfig() {
  try {
    const db = getDB();
    if (!db) return;
    const snap = await db.ref('config').once('value');
    const fbConfig = snap.val() || {};
    configCache = fbConfig;

    for (const key of CONFIG_KEYS) {
      if (fbConfig[key] !== undefined && fbConfig[key] !== null && fbConfig[key] !== '') {
        if (!process.env[key]) {
          process.env[key] = String(fbConfig[key]);
        }
      }
    }
  } catch (e) {
    console.warn('Could not load config from Firebase, using env vars:', e.message);
  }
}

function getConfig(key, fallback) {
  if (process.env[key]) return process.env[key];
  if (configCache && configCache[key] !== undefined) return String(configCache[key]);
  return fallback;
}

module.exports = { loadConfig, getConfig };
