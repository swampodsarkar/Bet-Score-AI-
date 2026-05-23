const express = require('express');
const router = express.Router();
const UserModel = require('../models/User');
const BetModel = require('../models/Bet');
const DepositModel = require('../models/Deposit');
const WithdrawModel = require('../models/Withdraw');
const { settlePendingBets } = require('../services/bettingService');
const { getBot } = require('../bot/telegramBot');

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || 'supersecretadmintoken123changeit';

function checkAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  req.adminToken = token;
  next();
}

router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

router.get('/stats', checkAdmin, async (req, res) => {
  try {
    const totalUsers = await UserModel.count();
    const totalBets = await BetModel.count();
    const pendingDeposits = await DepositModel.countPending();
    const pendingWithdraws = await WithdrawModel.countPending();
    const totalCoins = await UserModel.aggregateTotalBalance();

    res.json({
      totalUsers,
      totalBets,
      pendingDeposits,
      pendingWithdraws,
      totalCoins
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settle', checkAdmin, async (req, res) => {
  try {
    const count = await settlePendingBets();
    res.json({ settled: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pending-deposits', checkAdmin, async (req, res) => {
  try {
    const deposits = await DepositModel.findPending();
    res.json(deposits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deposits', checkAdmin, async (req, res) => {
  try {
    const ref = require('../config/firebase').getDB().ref('deposits');
    const snapshot = await ref.once('value');
    const data = [];
    snapshot.forEach(child => {
      data.push({ id: child.key, ...child.val() });
    });
    res.json(data.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/approve-deposit/:id', checkAdmin, async (req, res) => {
  try {
    const deposit = await DepositModel.findById(req.params.id);
    if (!deposit || deposit.status !== 'PENDING') return res.status(404).json({ error: 'Not found' });

    const user = await UserModel.findOne(deposit.telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await UserModel.update(deposit.telegramId, {
      balance: (user.balance || 0) + deposit.amount,
      totalDeposited: (user.totalDeposited || 0) + deposit.amount
    });

    await DepositModel.update(req.params.id, {
      status: 'APPROVED',
      approvedBy: 0,
      processedAt: new Date().toISOString()
    });

    try {
      const bot = getBot();
      if (bot) {
        const newBal = (user.balance || 0) + deposit.amount;
        await bot.sendMessage(deposit.telegramId, `🎉 Your deposit of *${deposit.amount} coins* has been approved!\n\nNew balance: ${newBal} coins`, { parse_mode: 'Markdown' });
      }
    } catch (e) {}

    const updatedUser = await UserModel.findOne(deposit.telegramId);
    res.json({ success: true, newBalance: updatedUser.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reject-deposit/:id', checkAdmin, async (req, res) => {
  try {
    const deposit = await DepositModel.findById(req.params.id);
    if (!deposit || deposit.status !== 'PENDING') return res.status(404).json({ error: 'Not found' });

    await DepositModel.update(req.params.id, {
      status: 'REJECTED',
      processedAt: new Date().toISOString()
    });

    try {
      const bot = getBot();
      if (bot) {
        await bot.sendMessage(deposit.telegramId, `❌ Your deposit request (TXID: ${deposit.txid}) was rejected. Contact admin if this is a mistake.`);
      }
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pending-withdraws', checkAdmin, async (req, res) => {
  try {
    const withdraws = await WithdrawModel.findPending();
    res.json(withdraws);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/withdraws', checkAdmin, async (req, res) => {
  try {
    const withdraws = await WithdrawModel.findAll();
    res.json(withdraws);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/approve-withdraw/:id', checkAdmin, async (req, res) => {
  try {
    const withdraw = await WithdrawModel.findById(req.params.id);
    if (!withdraw || withdraw.status !== 'PENDING') return res.status(404).json({ error: 'Not found' });

    await WithdrawModel.update(req.params.id, {
      status: 'APPROVED',
      approvedBy: 0,
      processedAt: new Date().toISOString()
    });

    try {
      const bot = getBot();
      if (bot) {
        await bot.sendMessage(withdraw.telegramId, `✅ Your withdraw of *${withdraw.amount} coins* has been approved and processed!`, { parse_mode: 'Markdown' });
      }
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reject-withdraw/:id', checkAdmin, async (req, res) => {
  try {
    const withdraw = await WithdrawModel.findById(req.params.id);
    if (!withdraw || withdraw.status !== 'PENDING') return res.status(404).json({ error: 'Not found' });

    await WithdrawModel.update(req.params.id, {
      status: 'REJECTED',
      processedAt: new Date().toISOString()
    });

    try {
      const bot = getBot();
      if (bot) {
        const user = await UserModel.findOne(withdraw.telegramId);
        const newBal = (user?.balance || 0) + withdraw.amount;
        await UserModel.update(withdraw.telegramId, { balance: newBal });
        await bot.sendMessage(withdraw.telegramId, `❌ Your withdraw of *${withdraw.amount} coins* was rejected. Amount refunded to your balance.`, { parse_mode: 'Markdown' });
      }
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', checkAdmin, async (req, res) => {
  try {
    const ref = require('../config/firebase').getDB().ref('users');
    const snapshot = await ref.once('value');
    const users = [];
    snapshot.forEach(child => {
      users.push({ telegramId: Number(child.key), ...child.val() });
    });
    res.json(users.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/add-coins', checkAdmin, async (req, res) => {
  try {
    const { telegramId, amount } = req.body;
    const user = await UserModel.findOne(Number(telegramId));
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newBalance = (user.balance || 0) + Number(amount);
    await UserModel.update(Number(telegramId), { balance: newBalance });

    try {
      const bot = getBot();
      if (bot) {
        await bot.sendMessage(Number(telegramId), `💰 Admin added *${amount} coins* to your account.\nNew balance: *${newBalance} coins*`, { parse_mode: 'Markdown' });
      }
    } catch (e) {}

    res.json({ success: true, newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deduct-coins', checkAdmin, async (req, res) => {
  try {
    const { telegramId, amount } = req.body;
    const user = await UserModel.findOne(Number(telegramId));
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newBalance = Math.max(0, (user.balance || 0) - Number(amount));
    await UserModel.update(Number(telegramId), { balance: newBalance });

    try {
      const bot = getBot();
      if (bot) {
        await bot.sendMessage(Number(telegramId), `⚠️ Admin deducted *${amount} coins* from your account.\nNew balance: *${newBalance} coins*`, { parse_mode: 'Markdown' });
      }
    } catch (e) {}

    res.json({ success: true, newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ban-user/:telegramId', checkAdmin, async (req, res) => {
  try {
    const telegramId = Number(req.params.telegramId);
    const user = await UserModel.findOne(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await UserModel.update(telegramId, { banned: true });

    try {
      const bot = getBot();
      if (bot) {
        await bot.sendMessage(telegramId, `🚫 You have been banned from Football Coin Predictor. Contact admin for details.`);
      }
    } catch (e) {}

    res.json({ success: true, message: 'User banned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/unban-user/:telegramId', checkAdmin, async (req, res) => {
  try {
    const telegramId = Number(req.params.telegramId);
    const user = await UserModel.findOne(telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await UserModel.update(telegramId, { banned: false });

    try {
      const bot = getBot();
      if (bot) {
        await bot.sendMessage(telegramId, `✅ You have been unbanned. You can now use the bot again!`);
      }
    } catch (e) {}

    res.json({ success: true, message: 'User unbanned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/send-notification', checkAdmin, async (req, res) => {
  try {
    const { message, telegramId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const bot = getBot();
    if (!bot) return res.status(500).json({ error: 'Bot not initialized' });

    if (telegramId) {
      await bot.sendMessage(Number(telegramId), message, { parse_mode: 'Markdown' });
      return res.json({ success: true, sentTo: 1 });
    }

    const ref = require('../config/firebase').getDB().ref('users');
    const snapshot = await ref.once('value');
    let sentCount = 0;
    const promises = [];
    snapshot.forEach(child => {
      const uid = Number(child.key);
      promises.push(
        bot.sendMessage(uid, message, { parse_mode: 'Markdown' }).then(() => sentCount++).catch(() => {})
      );
    });
    await Promise.all(promises);
    res.json({ success: true, sentTo: sentCount, total: snapshot.numChildren() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/config', checkAdmin, async (req, res) => {
  try {
    const ref = require('../config/firebase').getDB().ref('config');
    const snap = await ref.once('value');
    res.json(snap.val() || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/config', checkAdmin, async (req, res) => {
  try {
    const ref = require('../config/firebase').getDB().ref('config');
    await ref.update(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
