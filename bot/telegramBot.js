const TelegramBot = require('node-telegram-bot-api');
const UserModel = require('../models/User');
const DepositModel = require('../models/Deposit');
const { fetchUpcomingMatches, formatMatchForUser } = require('../services/footballService');
const { placeBet, getUserActiveBets } = require('../services/bettingService');
const { isAdmin, formatBalance, escapeMarkdown, parseBetCommand, getDisplayName } = require('../utils/helpers');

let bot;

const userStates = new Map();

function initBot(token) {
  bot = new TelegramBot(token, { polling: true });

  bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error.message);
  });

  registerHandlers();
  console.log('Telegram bot initialized with polling');
  return bot;
}

function registerHandlers() {
  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
      let user = await UserModel.findOne(telegramId);
      if (!user) {
        const defaultCoins = parseInt(process.env.DEFAULT_STARTING_COINS) || 1000;
        await UserModel.create({
          telegramId,
          username: msg.from.username || '',
          firstName: msg.from.first_name || '',
          balance: defaultCoins,
          totalDeposited: 0,
          totalWon: 0,
          totalBets: 0
        });
        await bot.sendMessage(chatId, 
          `🎉 *Welcome to Football Coin Predictor!*\n\n` +
          `You have received *${defaultCoins} starting coins*.\n\n` +
          `Let’s get started!`, 
          { parse_mode: 'Markdown' });
      }
      await sendMainMenu(chatId, telegramId);
    } catch (err) {
      console.error('Error in /start handler:', err);
      await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
    }
  });

  // Main Menu command
  bot.onText(/^\/menu$/, async (msg) => {
    await sendMainMenu(msg.chat.id, msg.from.id);
  });

  bot.onText(/^\/help$/, async (msg) => {
    const chatId = msg.chat.id;
    const helpText = `
⚽ *Football Coin Predictor Bot* - Virtual Prediction Game

*User Commands:*
/start - Register & get starting coins
/balance - Show your coin balance
/deposit <amount> - Get manual deposit instructions
/txid <transactionID> <amount> - Submit payment proof
/bet - List upcoming matches to bet on
/bet <matchID> <HOME|DRAW|AWAY> <stake> - Place bet directly
/mybets - View your active bets
/leaderboard - Top players by coins
/help - This message

*How Betting Works:*
- Correct prediction → stake × 2 coins back (net +stake profit)
/- Wrong → stake lost

*Example:*
/bet 1234567 HOME 250

*Admin only commands:* (if you are admin)
/pending /approve /reject /users /addcoins /deductcoins /settleall /stats

Play responsibly. All coins are virtual.
    `.trim();
    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/balance$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Please /start first');
    await bot.sendMessage(chatId, `💰 Your balance: *${formatBalance(user.balance)}*\n\nTotal deposited: ${user.totalDeposited}\nTotal won from bets: ${user.totalWon}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/deposit(?:\s+(\d+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const amount = match[1] ? parseInt(match[1]) : null;

    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    const min = parseInt(process.env.MIN_DEPOSIT) || 100;
    if (!amount || amount < min) {
      return bot.sendMessage(chatId, `Usage: /deposit <amount>\nMinimum deposit: ${min} coins\n\nExample: /deposit 500`);
    }

    const paymentInfo = process.env.PAYMENT_INSTRUCTIONS || 'Send payment via bKash/Nagad to the number in .env and reply with transaction ID.';
    const method = process.env.PAYMENT_METHOD || 'bKash/Nagad';
    const number = process.env.PAYMENT_NUMBER || '01XXXXXXXXX';

    const instructions = `📥 *Deposit Request*\n\nAmount: *${amount} coins*\n\nPlease send exactly *${amount}* BDT (or equivalent) to:\n\n*${method}*: ${number}\n\nAfter successful transfer, reply with:\n\`/txid YOUR_TRANSACTION_ID ${amount}\`\n\nExample: \`/txid 8K7P9Q2R ${amount}\`\n\n${paymentInfo}`;

    userStates.set(telegramId, { action: 'awaiting_txid', data: { amount } });
    await bot.sendMessage(chatId, instructions, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/txid\s+(\S+)\s+(\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const txid = match[1];
    const amount = parseInt(match[2]);

    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    const state = userStates.get(telegramId);
    if (!state || state.action !== 'awaiting_txid' || state.data.amount !== amount) {
      return bot.sendMessage(chatId, 'Please start with /deposit <amount> first, then submit txid.');
    }

    const existingDeposits = await DepositModel.findPending();
    const exists = existingDeposits.some(d => d.txid === txid);
    if (exists) return bot.sendMessage(chatId, 'This transaction ID was already submitted.');

    await DepositModel.create({
      telegramId,
      amount,
      txid,
      status: 'PENDING'
    });

    userStates.delete(telegramId);

    await bot.sendMessage(chatId, `✅ Transaction submitted!\n\nTXID: ${txid}\nAmount: ${amount} coins\n\nYour deposit is pending admin approval. You will be notified once approved.`);

    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(x => parseInt(x.trim()));
    for (const adminId of adminIds) {
      if (adminId) {
        try {
          await bot.sendMessage(adminId, `🔔 *New Deposit Pending*\n\nUser: ${telegramId} (${user.username || user.firstName})\nAmount: ${amount}\nTXID: ${txid}\n\nUse /pending to view and /approve ${deposit._id} to approve.`, { parse_mode: 'Markdown' });
        } catch (e) {}
      }
    }
  });

  bot.onText(/^\/bet$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    await bot.sendMessage(chatId, '⏳ Fetching upcoming matches from football API...');

    const matches = await fetchUpcomingMatches();
    if (!matches || matches.length === 0) {
      return bot.sendMessage(chatId, 'No upcoming matches available right now. Try again later.');
    }

    let text = '📅 *Upcoming Matches* (next 14 days)\n\n';
    const displayLimit = 15;
    const shown = matches.slice(0, displayLimit);

    shown.forEach((m, i) => {
      text += `${i + 1}. ${escapeMarkdown(formatMatchForUser(m))}\n`;
    });

    text += `\nTo place a bet, reply with:\n\`/bet <MATCH_ID> <HOME|DRAW|AWAY> <STAKE>\`\n\nExample: \`/bet ${shown[0].id} HOME 100\`\n\nYou have ${formatBalance(user.balance)}`;

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/bet\s+\d+\s+(HOME|DRAW|AWAY)\s+\d+$/i, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const parsed = parseBetCommand(msg.text);
    if (!parsed) return bot.sendMessage(chatId, 'Invalid format. Use: /bet <matchID> <HOME|DRAW|AWAY> <stake>');

    try {
      const bet = await placeBet(telegramId, parsed.matchId, parsed.prediction, parsed.stake);
      await bot.sendMessage(chatId, `✅ Bet placed successfully!\n\nMatch ID: ${parsed.matchId}\nPrediction: ${parsed.prediction}\nStake: ${parsed.stake} coins\n\nGood luck! Use /mybets to track.`);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/^\/mybets$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const bets = await getUserActiveBets(telegramId);
    if (!bets.length) return bot.sendMessage(chatId, 'You have no active bets.');

    let text = '📋 *Your Active Bets:*\n\n';
    for (const bet of bets) {
      text += `• ${escapeMarkdown(bet.homeTeam)} vs ${escapeMarkdown(bet.awayTeam)}\n  ID: ${bet.matchId} | Bet: ${bet.prediction} | Stake: ${bet.stake}\n\n`;
    }
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/leaderboard$/, async (msg) => {
    const chatId = msg.chat.id;
    const top = await UserModel.findTop(10);
    let text = '🏆 *Top Players*\n\n';
    top.forEach((u, i) => {
      const name = escapeMarkdown(u.username || u.firstName || 'Anonymous');
      text += `${i + 1}. ${name} — ${formatBalance(u.balance)}\n`;
    });
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/pending$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const pending = await DepositModel.findPending();
    if (!pending.length) return bot.sendMessage(chatId, 'No pending deposits.');

    let text = '📥 *Pending Deposits:*\n\n';
    pending.forEach(d => {
      const name = d.userId ? (d.userId.username || d.userId.firstName) : d.telegramId;
      text += `ID: \`${d._id}\`\nUser: ${d.telegramId} (${name})\nAmount: ${d.amount}\nTXID: ${d.txid}\n\n`;
    });
    text += 'Approve with: /approve <depositID>';
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/approve\s+([a-f0-9]{24})$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const depositId = match[1];
    const deposit = await DepositModel.findById(depositId);
    if (!deposit || deposit.status !== 'PENDING') return bot.sendMessage(chatId, 'Deposit not found or already processed');

    const user = await UserModel.findOne(deposit.telegramId);
    if (!user) return bot.sendMessage(chatId, 'User no longer exists');

    await UserModel.update(deposit.telegramId, {
      balance: (user.balance || 0) + deposit.amount,
      totalDeposited: (user.totalDeposited || 0) + deposit.amount
    });

    await DepositModel.update(depositId, {
      status: 'APPROVED',
      approvedBy: telegramId,
      processedAt: new Date().toISOString()
    });

    await bot.sendMessage(chatId, `✅ Approved deposit ${depositId}\n+${deposit.amount} coins to user ${user.telegramId}`);
    try {
      await bot.sendMessage(user.telegramId, `🎉 Your deposit of ${deposit.amount} coins has been approved!\n\nNew balance: ${formatBalance(user.balance)}`);
    } catch (e) {}
  });

  bot.onText(/^\/reject\s+([a-f0-9]{24})$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const deposit = await DepositModel.findById(match[1]);
    if (!deposit || deposit.status !== 'PENDING') return bot.sendMessage(chatId, 'Not found');

    await DepositModel.update(match[1], {
      status: 'REJECTED',
      approvedBy: telegramId,
      processedAt: new Date().toISOString()
    });

    await bot.sendMessage(chatId, `❌ Rejected deposit ${match[1]}`);
    try {
      await bot.sendMessage(deposit.telegramId, `Your deposit request (TXID: ${deposit.txid}) was rejected. Contact admin if this is a mistake.`);
    } catch (e) {}
  });

  bot.onText(/^\/users$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const users = await UserModel.findTop(15);
    let text = '👥 *Recent Users:*\n\n';
    users.forEach(u => {
      text += `${u.telegramId} | ${u.username || u.firstName} | Bal: ${u.balance} | Bets: ${u.totalBets}\n`;
    });
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/addcoins\s+(\d+)\s+(\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const targetId = parseInt(match[1]);
    const amt = parseInt(match[2]);
    const user = await UserModel.findOne(targetId);
    if (!user) return bot.sendMessage(chatId, 'User not found');

    await UserModel.update(targetId, {
      balance: (user.balance || 0) + amt
    });
    await bot.sendMessage(chatId, `✅ Added ${amt} coins to ${targetId}. New balance: ${user.balance}`);
    try { await bot.sendMessage(targetId, `Admin added ${amt} coins to your account. New balance: ${formatBalance(user.balance)}`); } catch (e) {}
  });

  bot.onText(/^\/deductcoins\s+(\d+)\s+(\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const targetId = parseInt(match[1]);
    const amt = parseInt(match[2]);
    const user = await UserModel.findOne(targetId);
    if (!user) return bot.sendMessage(chatId, 'User not found');

    const newBal = Math.max(0, (user.balance || 0) - amt);
    await UserModel.update(targetId, { balance: newBal });
    await bot.sendMessage(chatId, `✅ Deducted ${amt} coins from ${targetId}. New balance: ${user.balance}`);
  });

  bot.onText(/^\/settleall$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    await bot.sendMessage(chatId, '⏳ Running settlement...');
    const { settlePendingBets } = require('../services/bettingService');
    const count = await settlePendingBets();
    await bot.sendMessage(chatId, `✅ Settlement complete. ${count} bets settled.`);
  });

  bot.onText(/^\/stats$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const totalUsers = await UserModel.count();
    const totalBets = await require('../models/Bet').count();
    const pendingDeposits = await DepositModel.countPending();
    const totalCoins = await UserModel.aggregateTotalBalance();

    await bot.sendMessage(chatId, `📊 *Bot Stats*\n\nUsers: ${totalUsers}\nTotal Bets: ${totalBets}\nPending Deposits: ${pendingDeposits}\nTotal Coins in Circulation: ${totalCoins[0]?.total || 0}`, { parse_mode: 'Markdown' });
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const state = userStates.get(telegramId);

    if (state && state.action === 'awaiting_txid') {
      await bot.sendMessage(chatId, 'Please use the exact format: /txid YOUR_TX_ID amount');
    } 
    else if (state && state.action === 'awaiting_withdraw_amount') {
      const amount = parseInt(msg.text);
      if (!amount || amount < 100) {
        return bot.sendMessage(chatId, '❌ Please enter a valid amount (minimum 100 coins).');
      }

      const user = await UserModel.findOne(telegramId);
      if (!user || user.balance < amount) {
        userStates.delete(telegramId);
        return bot.sendMessage(chatId, '❌ Insufficient balance for withdrawal.');
      }

      console.log(`[WITHDRAW REQUEST] User: ${telegramId} | Amount: ${amount}`);

      const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(x => parseInt(x.trim()));
      for (const adminId of adminIds) {
        if (adminId) {
          try {
            await bot.sendMessage(adminId, 
              `💸 *New Withdraw Request*\n\n` +
              `User ID: ${telegramId}\n` +
              `Amount: ${amount} coins`);
          } catch (e) {}
        }
      }

      userStates.delete(telegramId);
      await bot.sendMessage(chatId, 
        `✅ Withdraw request submitted for *${amount} coins*.\n\n` +
        `Admin will process it soon.`, 
        { parse_mode: 'Markdown' });
    } 

    else if (state && state.action === 'awaiting_deposit_amount') {
      const amount = parseInt(msg.text);
      if (!amount || amount < (parseInt(process.env.MIN_DEPOSIT) || 100)) {
        return bot.sendMessage(chatId, `❌ Minimum deposit is ${process.env.MIN_DEPOSIT || 100} coins.`);
      }
      userStates.set(telegramId, { action: 'awaiting_txid', data: { amount } });
      await bot.sendMessage(chatId, 
        `Great! You want to deposit *${amount} coins*.\n\n` +
        `Now send payment and reply with:\n` +
        `/txid YOUR_TX_ID ${amount}`, { parse_mode: 'Markdown' });
    } 
    else {
      await bot.sendMessage(chatId, 'Unknown command. Type /help or /menu');
    }
  });

  // Handle button clicks (Inline Keyboard)
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;

    try {
      if (data === 'balance') {
        const user = await UserModel.findOne(telegramId);
        const bal = user ? formatBalance(user.balance) : '0 coins';
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, `💰 Your Balance: *${bal}*`, { parse_mode: 'Markdown' });
      }

      else if (data === 'deposit') {
        await bot.answerCallbackQuery(query.id);
        
        const depositKeyboard = {
          inline_keyboard: [
            [
              { text: '100', callback_data: 'quick_deposit_100' },
              { text: '500', callback_data: 'quick_deposit_500' },
              { text: '1000', callback_data: 'quick_deposit_1000' }
            ],
            [
              { text: '2000', callback_data: 'quick_deposit_2000' },
              { text: '5000', callback_data: 'quick_deposit_5000' },
              { text: 'Custom Amount', callback_data: 'deposit_custom' }
            ],
            [{ text: '⬅️ Back to Menu', callback_data: 'menu' }]
          ]
        };

        await bot.sendMessage(chatId, 
          `💵 *Deposit Coins*\n\n` +
          `Choose an amount or enter custom:`, 
          { parse_mode: 'Markdown', reply_markup: depositKeyboard });
      }

      else if (data === 'mybets') {
        await bot.answerCallbackQuery(query.id);
        const bets = await getUserActiveBets(telegramId);
        if (bets.length === 0) {
          await bot.sendMessage(chatId, 'You have no active bets.');
        } else {
          let text = '📋 *Your Active Bets:*\n\n';
          bets.forEach(b => {
            text += `• ${b.homeTeam} vs ${b.awayTeam}\n  Prediction: ${b.prediction} | Stake: ${b.stake}\n\n`;
          });
          await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }
      }

      else if (data === 'leaderboard') {
        await bot.answerCallbackQuery(query.id);
        const top = await UserModel.findTop(10);
        let text = '🏆 *Top Players*\n\n';
        top.forEach((u, i) => {
          const name = getDisplayName(u);
          text += `${i+1}. ${escapeMarkdown(name)} — ${formatBalance(u.balance)}\n`;
        });
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }

      else if (data === 'bet') {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, 
          `⚽ *Place Your Bet*\n\n` +
          `To bet, reply with this format:\n\n` +
          `\`/bet <MatchID> <HOME|DRAW|AWAY> <Stake>\`\n\n` +
          `Example: \`/bet 1234567 HOME 200\`\n\n` +
          `First type /bet to see the list of upcoming matches with Match IDs.`, 
          { parse_mode: 'Markdown' });
      }

      else if (data === 'help') {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, 'Use /help to see all available commands, or click the buttons in the menu.');
      }

      else if (data === 'menu') {
        await bot.answerCallbackQuery(query.id);
        await sendMainMenu(chatId, telegramId);
      }

      else if (data === 'withdraw') {
        await bot.answerCallbackQuery(query.id);
        userStates.set(telegramId, { action: 'awaiting_withdraw_amount' });
        await bot.sendMessage(chatId, 
          `💸 *Withdraw Request*\n\n` +
          `Please reply with the amount you want to withdraw:\n\n` +
          `Example: \`500\`\n\n` +
          `Minimum: 100 coins\n\n` +
          `Note: Withdrawals are processed manually by admin.`);
      }

      else if (data.startsWith('quick_deposit_')) {
        const amount = parseInt(data.replace('quick_deposit_', ''));
        await bot.answerCallbackQuery(query.id);
        userStates.set(telegramId, { action: 'awaiting_txid', data: { amount } });
        await bot.sendMessage(chatId, 
          `💵 You selected *${amount} coins*.\n\n` +
          `Please send payment via bKash/Nagad and reply with:\n` +
          `/txid YOUR_TRANSACTION_ID ${amount}\n\n` +
          `Example: \`/txid 8K7P9Q2R ${amount}\`` , { parse_mode: 'Markdown' });
      }

      else if (data === 'deposit_custom') {
        await bot.answerCallbackQuery(query.id);
        userStates.set(telegramId, { action: 'awaiting_deposit_amount' });
        await bot.sendMessage(chatId, `Please type the amount you want to deposit (e.g. 750):`);
      }
    } catch (err) {
      console.error('Callback query error:', err);
      await bot.answerCallbackQuery(query.id, { text: 'Error occurred' });
    }
  });
}

// ==================== PREMIUM MAIN MENU ====================
async function sendMainMenu(chatId, telegramId) {
  const user = await UserModel.findOne(telegramId);
  const balanceText = user ? formatBalance(user.balance) : '0 coins';
  const displayName = getDisplayName(user);

  const text = 
    `⚽ *Football Coin Predictor*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👋 Hello, *${escapeMarkdown(displayName)}*!\n\n` +
    `💰 *Current Balance*\n` +
    `   ${balanceText}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎮 *Main Menu*`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💰  Balance', callback_data: 'balance' },
        { text: '💵  Deposit', callback_data: 'deposit' }
      ],
      [
        { text: '💸  Withdraw', callback_data: 'withdraw' },
        { text: '📋  My Bets', callback_data: 'mybets' }
      ],
      [
        { text: '🏆  Leaderboard', callback_data: 'leaderboard' },
        { text: '⚽  Place Bet', callback_data: 'bet' }
      ],
      [
        { text: '🔄  Refresh Menu', callback_data: 'menu' },
        { text: '❓  Help', callback_data: 'help' }
      ]
    ]
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}


module.exports = { initBot };
