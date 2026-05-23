require('dotenv').config();

const express = require('express');
const { initFirebase, getDB } = require('./config/firebase');
const { loadConfig } = require('./config/appConfig');
const cron = require('node-cron');
const { settlePendingBets } = require('./services/bettingService');
const { initBot } = require('./bot/telegramBot');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('Football Coin Predictor Bot is running. Use Telegram to interact.');
});

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

app.get('/admin/login', (req, res) => {
  res.sendFile(__dirname + '/public/admin-login.html');
});

// Admin login (email + password)
app.post('/admin/login', express.json(), (req, res) => {
  const { email, password } = req.body;

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mdswampodsarkar@gmail.com';
  const ADMIN_PASS = process.env.ADMIN_PASS || '123456';
  const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || 'supersecretadmintoken123changeit';

  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    return res.json({ success: true, token: ADMIN_TOKEN });
  }

  res.status(401).json({ error: 'Invalid email or password' });
});

app.use('/admin', adminRoutes);

// Initialize Firebase Realtime Database
initFirebase();

// Load app config from Firebase (overrides .env for missing vars)
loadConfig().catch(() => {});

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required in .env');
  process.exit(1);
}

const { getBot } = require('./bot/telegramBot');
const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';
if (publicUrl) {
  app.post(`/bot${token}`, async (req, res) => {
    try {
      const bot = getBot();
      if (bot) await bot.processUpdate(req.body);
    } catch (e) {
      console.error('processUpdate error:', e.message);
    }
    res.sendStatus(200);
  });
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});
initBot(token, publicUrl || '');

const interval = parseInt(process.env.SETTLE_INTERVAL_MINUTES) || 10;
cron.schedule(`*/${interval} * * * *`, async () => {
  console.log('Running scheduled bet settlement...');
  try {
    const settled = await settlePendingBets();
    if (settled > 0) console.log(`Settled ${settled} bets`);
  } catch (e) {
    console.error('Settlement cron error:', e.message);
  }
});

setTimeout(async () => {
  try {
    const settled = await settlePendingBets();
    console.log(`Initial settlement check: ${settled} bets settled`);
  } catch (e) {}
}, 30000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Bot is active. Send /start to your bot in Telegram.`);
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
