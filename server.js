require('dotenv').config();

const express = require('express');
const { initFirebase } = require('./config/firebase');
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

  const ADMIN_EMAIL = 'mdswampodsarkar@gmail.com';
  const ADMIN_PASS = '123456';
  const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || 'supersecretadmintoken123changeit';

  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    return res.json({ success: true, token: ADMIN_TOKEN });
  }

  res.status(401).json({ error: 'Invalid email or password' });
});

app.use('/admin', adminRoutes);

// Initialize Firebase Realtime Database
initFirebase();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required in .env');
  process.exit(1);
}

initBot(token);

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
