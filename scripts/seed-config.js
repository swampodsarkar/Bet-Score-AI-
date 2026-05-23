require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initFirebase, getDB } = require('../config/firebase');

const CONFIG_KEYS = [
  'PAYMENT_METHOD', 'PAYMENT_NUMBER', 'PAYMENT_INSTRUCTIONS',
  'MIN_DEPOSIT', 'DEFAULT_STARTING_COINS', 'ADMIN_USER_IDS',
  'ADMIN_API_TOKEN', 'ADMIN_EMAIL', 'ADMIN_PASS'
];

async function seed() {
  initFirebase();
  const db = getDB();
  if (!db) { console.error('Firebase not initialized'); process.exit(1); }

  const config = {};
  for (const key of CONFIG_KEYS) {
    if (process.env[key]) config[key] = process.env[key];
  }

  if (Object.keys(config).length === 0) {
    console.log('No config keys found in .env to seed.');
    return;
  }

  await db.ref('config').update(config);
  console.log('Config seeded to Firebase /config:');
  console.log(JSON.stringify(config, null, 2));
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
