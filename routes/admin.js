const express = require('express');
const router = express.Router();
const UserModel = require('../models/User');
const BetModel = require('../models/Bet');
const DepositModel = require('../models/Deposit');
const { settlePendingBets } = require('../services/bettingService');

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || 'supersecretadmintoken123';

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
    const totalCoins = await UserModel.aggregateTotalBalance();

    res.json({
      totalUsers,
      totalBets,
      pendingDeposits,
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

router.post('/approve/:id', checkAdmin, async (req, res) => {
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

    const updatedUser = await UserModel.findOne(deposit.telegramId);
    res.json({ success: true, newBalance: updatedUser.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reject/:id', checkAdmin, async (req, res) => {
  try {
    const deposit = await DepositModel.findById(req.params.id);
    if (!deposit || deposit.status !== 'PENDING') return res.status(404).json({ error: 'Not found' });

    await DepositModel.update(req.params.id, {
      status: 'REJECTED',
      processedAt: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', checkAdmin, async (req, res) => {
  try {
    const users = await UserModel.findTop(100);
    res.json(users);
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

    res.json({ success: true, newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
