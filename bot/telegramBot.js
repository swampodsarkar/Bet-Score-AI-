const TelegramBot = require('node-telegram-bot-api');
const UserModel = require('../models/User');
const BetModel = require('../models/Bet');
const DepositModel = require('../models/Deposit');
const WithdrawModel = require('../models/Withdraw');
const { fetchUpcomingMatches, fetchMatchById, getMatchesByCompetition, isMatchLive, canBetOnMatch, getLiveScore, LEAGUES } = require('../services/footballService');
const { placeBet, getUserActiveBets, cancelBet } = require('../services/bettingService');
const { isAdmin, formatBalance, escapeMarkdown, parseBetCommand, getDisplayName, generateReferralLink, calcWinRate, isVipActive } = require('../utils/helpers');

let bot;

const userStates = new Map();

function initBot(token, useWebhook) {
  const publicUrl = useWebhook || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';

  if (publicUrl) {
    bot = new TelegramBot(token);
    bot.setWebHook(`${publicUrl}/bot${token}`);
    registerHandlers();
    console.log(`Telegram bot initialized with webhook: ${publicUrl}/bot${token}`);
  } else {
    bot = new TelegramBot(token, { polling: true });
    bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error.message);
    });
    registerHandlers();
    console.log('Telegram bot initialized with polling');
  }
  return bot;
}

function registerHandlers() {
  bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const refParam = match[1] || '';

    try {
      let user = await UserModel.findOne(telegramId);
      if (!user) {
        const defaultCoins = parseInt(process.env.DEFAULT_STARTING_COINS) || 1000;
        let referredBy = null;
        let welcomeExtra = '';

        // Handle referral
        if (refParam.startsWith('ref_')) {
          const refId = parseInt(refParam.replace('ref_', ''));
          if (refId && refId !== telegramId) {
            const referrer = await UserModel.findOne(refId);
            if (referrer) {
              referredBy = refId;
              const REFERRAL_BONUS = parseInt(process.env.REFERRAL_BONUS) || 500;
              await UserModel.update(refId, {
                balance: (referrer.balance || 0) + REFERRAL_BONUS,
                referralEarnings: (referrer.referralEarnings || 0) + REFERRAL_BONUS,
                referralCount: (referrer.referralCount || 0) + 1
              });
              welcomeExtra = `\n🎁 Referred by ${getDisplayName(referrer)}\n💎 You both get +${REFERRAL_BONUS} coins!`;
              try {
                const botName = process.env.BOT_NAME || 'betpredictorbot';
                await bot.sendMessage(refId, `🎉 Someone joined using your referral link!\n💰 You earned +${REFERRAL_BONUS} coins!`);
              } catch (e) {}
            }
          }
        }

        await UserModel.create({
          telegramId,
          username: msg.from.username || '',
          firstName: msg.from.first_name || '',
          balance: referredBy ? (defaultCoins + 500) : defaultCoins,
          totalDeposited: 0,
          totalWon: 0,
          totalBets: 0,
          totalWins: 0,
          referredBy
        });
        await bot.sendMessage(chatId, 
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  🎉 WELCOME ABOARD!\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🌟 ${getDisplayName({username: msg.from.username, firstName: msg.from.first_name})}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🎁 You received +${referredBy ? (defaultCoins + 500) : defaultCoins} coins${welcomeExtra}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Tap /menu to start playing!`);
      } else {
        await UserModel.update(telegramId, {
          username: msg.from.username || '',
          firstName: msg.from.first_name || ''
        });
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
    const helpText = 
`▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
▰  ⚽  *HELP & GUIDE*  📖  ▰
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎮 *Commands*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏠 /menu    — Main menu
💰 /balance — Check coins
🎁 /daily   — Claim daily bonus
⚽ /bet     — Browse & place bets
📋 /mybets  — Your active bets
🏆 /leaderboard — Top players
🔴 /livescore  — Live match scores
❌ /cancelbet  — Cancel a pending bet
❌ /canceldeposit  — Cancel a pending deposit

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *How Betting Works*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Correct → stake × 2 coins back
❌ Wrong   → stake lost

1️⃣ /bet → See match list
2️⃣ Select match → Pick HOME/DRAW/AWAY
3️⃣ Enter stake → Done! 🎯

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 *Admins Only*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/pending /approve /reject /users
/addcoins /deductcoins /settleall /stats

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 *Play responsibly. Virtual coins only.*`;
    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/balance$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Please /start first');

    const msgText = 
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `▰      💰  *MY WALLET*     ▰\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
      `💳 Balance        ${escapeMarkdown(formatBalance(user.balance))}\n` +
      `📥 Deposited      ${String(user.totalDeposited || 0)}\n` +
      `🏆 Won from bets  ${String(user.totalWon || 0)}\n` +
      `🎯 Total bets     ${String(user.totalBets || 0)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 Net Profit: ${String((user.totalWon || 0) - (user.totalDeposited || 0))} coins`;

    await bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
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

    const instructions = `📥 Deposit Request\n\nAmount: ${amount} coins\n\nPlease send exactly ${amount} BDT (or equivalent) to:\n\n${method}: ${number}\n\nAfter successful transfer, reply with:\n/txid YOUR_TRANSACTION_ID ${amount}\n\nExample: /txid 8K7P9Q2R ${amount}\n\n${paymentInfo}`;

    userStates.set(telegramId, { action: 'awaiting_txid', data: { amount } });
    await bot.sendMessage(chatId, 
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `▰     💵  DEPOSIT REQUEST   ▰\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
      `💰 Amount: ${amount} coins\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Send exactly ${amount} BDT to:\n\n` +
      `📱 ${method}: ${number}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `After payment, reply with:\n` +
      `/txid YOUR_TXID ${amount}\n\n` +
      `Example: /txid 8K7P9Q2R ${amount}`);
  });

  bot.onText(/^\/txid\s+(\S+)\s+(\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const txid = match[1];
    const amount = parseInt(match[2]);

    try {
      const user = await UserModel.findOne(telegramId);
      if (!user) return bot.sendMessage(chatId, 'Use /start first');

      const state = userStates.get(telegramId);
      if (!state || state.action !== 'awaiting_txid' || state.data.amount !== amount) {
        return bot.sendMessage(chatId, 'Please start with /deposit <amount> first, then submit txid.');
      }

      const existingDeposits = await DepositModel.findPending();
      const exists = existingDeposits.some(d => d.txid === txid);
      if (exists) return bot.sendMessage(chatId, 'This transaction ID was already submitted.');

      const deposit = await DepositModel.create({
        telegramId,
        amount,
        txid,
        status: 'PENDING'
      });

      userStates.delete(telegramId);

      await bot.sendMessage(chatId, 
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
        `▰    ✅  TXID SUBMITTED      ▰\n` +
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
        `📌 TXID: ${txid}\n` +
        `💰 Amount: ${amount} coins\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⏳ Pending admin approval.\n` +
        `You will be notified once approved.`);

      const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(x => parseInt(x.trim()));
      for (const adminId of adminIds) {
        if (adminId) {
          try {
            await bot.sendMessage(adminId, `🔔 New Deposit Pending\n\nUser: ${telegramId} (${user.username || user.firstName})\nAmount: ${amount}\nTXID: ${txid}\n\nUse /pending to view and /approve ${deposit.id} to approve.`);
          } catch (e) {}
        }
      }
    } catch (err) {
      console.error('Deposit error:', err);
      bot.sendMessage(chatId, 'Error processing deposit. Please try again later.');
    }
  });

  bot.onText(/^\/bet$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    const text =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  🎯 PLACE BET\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Step 1: Select a league`;
    await bot.sendMessage(chatId, text, { reply_markup: buildLeagueKeyboard('league_bet') });
  });

  async function showMatchPage(chatId, telegramId, matches, page) {
    const perPage = 5;
    const totalPages = Math.ceil(matches.length / perPage);
    const start = page * perPage;
    const pageMatches = matches.slice(start, start + perPage);

    let text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ⚽ MATCHES (Page ${page + 1}/${totalPages})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    const keyboard = [];

    for (const m of pageMatches) {
      const home = m.homeTeam?.shortName || m.homeTeam?.name || 'Home';
      const away = m.awayTeam?.shortName || m.awayTeam?.name || 'Away';
      const date = new Date(m.utcDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const comp = m.competition?.code || '';
      const live = isMatchLive(m);
      const canBet = canBetOnMatch(m);
      const score = live ? getLiveScore(m) : null;
      const scoreStr = score ? ` ⚽ ${score}` : '';
      text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `${live ? '🔴' : '⚽'} ${home} vs ${away}${scoreStr}\n`;
      text += `${live ? '🔴 LIVE' : `📅 ${date}`} | ${comp}\n`;
      if (canBet) {
        keyboard.push([{ text: `✅ ${home} vs ${away}`, callback_data: `match_${m.id}` }]);
      } else {
        keyboard.push([{ text: `👀 ${home} vs ${away}${live ? ' (LIVE)' : ' (Bet Closed)'}`, callback_data: `noop` }]);
      }
    }

    const navRow = [];
    if (page > 0) navRow.push({ text: '◀️ Prev', callback_data: `page_${page - 1}` });
    if (page < totalPages - 1) navRow.push({ text: 'Next ▶️', callback_data: `page_${page + 1}` });
    if (navRow.length) keyboard.push(navRow);
    keyboard.push([{ text: '🔙 Back to Menu', callback_data: 'menu' }]);

    const user = await UserModel.findOne(telegramId);
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💰 Balance: ${user ? formatBalance(user.balance) : '0 coins'}`;

    await bot.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  bot.onText(/^\/bet\s+\d+\s+(HOME|DRAW|AWAY)\s+\d+(?:\s+\d+-\d+)?$/i, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const parsed = parseBetCommand(msg.text);
    if (!parsed) return bot.sendMessage(chatId, 'Invalid format. Use: /bet <matchID> <HOME|DRAW|AWAY> <stake> [score]\nExample: /bet 123 HOME 100 2-1');

    const parts = msg.text.trim().split(/\s+/);
    const predictedScore = parts.length >= 5 ? parts[4] : null;

    try {
      const bet = await placeBet(telegramId, parsed.matchId, parsed.prediction, parsed.stake, predictedScore);
      const scoreStr = predictedScore ? `\n🎯 Score: ${predictedScore}` : '';
      const menuKeyboard = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };
      await bot.sendMessage(chatId, `✅ Bet placed!\n\nMatch ID: ${parsed.matchId}\nPrediction: ${parsed.prediction}\nStake: ${parsed.stake} coins${scoreStr}\n\nGood luck!`, { reply_markup: menuKeyboard });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/^\/mybets$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const bets = await getUserActiveBets(telegramId);
    if (!bets.length) return bot.sendMessage(chatId, '📋 *No Active Bets*\n\nYou have no active bets.\nUse /bet to place one! 🎯');

    let text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  📋 MY ACTIVE BETS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const bet of bets) {
      const teamName = bet.prediction === 'HOME' ? bet.homeTeam : bet.prediction === 'AWAY' ? bet.awayTeam : 'DRAW';
      const predEmoji = bet.prediction === 'HOME' ? '🏠' : bet.prediction === 'AWAY' ? '✈️' : '🤝';
      const scoreStr = bet.predictedScore ? ` 🎯 ${bet.predictedScore}` : '';
      text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `⚽ ${bet.homeTeam} vs ${bet.awayTeam}\n`;
      text += `${predEmoji} ${teamName}${scoreStr}  •  💰 ${bet.stake} coins\n`;
      text += `🆔 \`${bet.id}\`\n`;
    }
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📌 Total Active: ${bets.length} bet(s)\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `❌ To cancel: /cancelbet <BetID>`;
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/cancelbet(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const betId = match[1] ? match[1].trim() : null;

    if (!betId) {
      const bets = await getUserActiveBets(telegramId);
      if (!bets.length) return bot.sendMessage(chatId, 'You have no active bets to cancel.\n\nUsage: /cancelbet <BetID>\nUse /mybets to see your bet IDs.');
      let text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ❌ CANCEL A BET\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nYour active bets:\n\n`;
      for (const b of bets) {
        text += `🆔 \`${b.id}\`\n⚽ ${b.homeTeam} vs ${b.awayTeam}\n💰 ${b.stake} coins\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      }
      text += `\nUsage: /cancelbet <BetID>`;
      return await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }

    try {
      const bet = await cancelBet(telegramId, betId);
      const teamName = bet.prediction === 'HOME' ? bet.homeTeam : bet.prediction === 'AWAY' ? bet.awayTeam : 'DRAW';
      const menuKb = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };
      await bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌ BET CANCELLED\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⚽ ${bet.homeTeam} vs ${bet.awayTeam}\n` +
        `🎯 ${teamName}\n` +
        `💰 ${bet.stake} coins refunded\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { reply_markup: menuKb });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/^\/canceldeposit(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const depositId = match[1] ? match[1].trim() : null;

    if (!depositId) {
      const deposits = await DepositModel.findPendingByTelegramId(telegramId);
      if (!deposits.length) return bot.sendMessage(chatId, 'You have no pending deposits to cancel.\n\nUsage: /canceldeposit <DepositID>');
      let text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ❌ CANCEL A DEPOSIT\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nYour pending deposits:\n\n`;
      for (const d of deposits) {
        text += `🆔 \`${d.id}\`\n💰 ${d.amount} coins\n📌 TXID: ${d.txid}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      }
      text += `\nUsage: /canceldeposit <DepositID>`;
      return await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }

    try {
      const deposit = await DepositModel.findById(depositId);
      if (!deposit) throw new Error('Deposit not found');
      if (Number(deposit.telegramId) !== Number(telegramId)) throw new Error('This deposit does not belong to you');
      if (deposit.status !== 'PENDING') throw new Error('Deposit is already processed or cancelled');

      await DepositModel.update(depositId, {
        status: 'CANCELLED',
        processedAt: new Date().toISOString()
      });

      userStates.delete(telegramId);

      const menuKb = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };
      await bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌ DEPOSIT CANCELLED\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💰 Amount: ${deposit.amount} coins\n` +
        `📌 TXID: ${deposit.txid}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { reply_markup: menuKb });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  bot.onText(/^\/leaderboard$/, async (msg) => {
    const chatId = msg.chat.id;
    const top = await UserModel.findTop(10);
    let text = `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n▰     🏆  *LEADERBOARD*       ▰\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n`;
    const medals = ['🥇', '🥈', '🥉'];
    top.forEach((u, i) => {
      const medal = medals[i] || `#${i + 1}`;
      const name = escapeMarkdown(u.username || u.firstName || 'Anonymous');
      text += `${medal} ${name.padEnd(20)} 💰 ${formatBalance(u.balance)}\n`;
    });
    text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `💪 *Compete & earn more coins!*`;
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
      text += `ID: \`${d.id}\`\nUser: ${d.telegramId}\nAmount: ${d.amount}\nTXID: ${d.txid}\n\n`;
    });
    text += 'Approve with: /approve <depositID>';
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/approve\s+([\w-]+)$/, async (msg, match) => {
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

    const newBal = (user.balance || 0) + deposit.amount;
    await bot.sendMessage(chatId, `✅ Approved deposit ${depositId}\n+${deposit.amount} coins to user ${user.telegramId}`);
    try {
      await bot.sendMessage(user.telegramId, `🎉 Your deposit of ${deposit.amount} coins has been approved!\n\nNew balance: ${formatBalance(newBal)}`);
    } catch (e) {}
  });

  bot.onText(/^\/reject\s+([\w-]+)$/, async (msg, match) => {
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

    const newAddBal = (user.balance || 0) + amt;
    await UserModel.update(targetId, {
      balance: newAddBal
    });
    await bot.sendMessage(chatId, `✅ Added ${amt} coins to ${targetId}. New balance: ${newAddBal}`);
    try { await bot.sendMessage(targetId, `Admin added ${amt} coins to your account. New balance: ${formatBalance(newAddBal)}`); } catch (e) {}
  });

  bot.onText(/^\/deductcoins\s+(\d+)\s+(\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const targetId = parseInt(match[1]);
    const amt = parseInt(match[2]);
    const user = await UserModel.findOne(targetId);
    if (!user) return bot.sendMessage(chatId, 'User not found');

    const newDedBal = Math.max(0, (user.balance || 0) - amt);
    await UserModel.update(targetId, { balance: newDedBal });
    await bot.sendMessage(chatId, `✅ Deducted ${amt} coins from ${targetId}. New balance: ${newDedBal}`);
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

    await bot.sendMessage(chatId, `📊 *Bot Stats*\n\nUsers: ${totalUsers}\nTotal Bets: ${totalBets}\nPending Deposits: ${pendingDeposits}\nTotal Coins in Circulation: ${totalCoins}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/daily$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    try {
      const user = await UserModel.findOne(telegramId);
      if (!user) return bot.sendMessage(chatId, 'Use /start first');

      const now = Date.now();
      const last = user.lastDailyClaim || 0;
      const DAY_MS = 24 * 60 * 60 * 1000;

      if (now - last < DAY_MS) {
        const remaining = DAY_MS - (now - last);
        const hours = Math.floor(remaining / 3600000);
        const mins = Math.floor((remaining % 3600000) / 60000);
        return bot.sendMessage(chatId, `⏳ You already claimed today.\nCome back in ${hours}h ${mins}m.`);
      }

      const isVip = isVipActive(user);
      const BONUS = isVip ? 1.0 : 0.5;
      const newBal = (user.balance || 0) + BONUS;
      await UserModel.update(telegramId, { balance: newBal, lastDailyClaim: now });

      const vipMsg = isVip ? ' (VIP Double Bonus!)' : '';
      const menuKb = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };
      await bot.sendMessage(chatId, 
        `🎁 Daily Bonus Claimed${vipMsg}!\n\n` +
        `You received +${BONUS} coins\n` +
        `New balance: ${newBal} coins\n\n` +
        `Come back tomorrow for another bonus.`,
        { reply_markup: menuKb });
    } catch (err) {
      console.error('Daily bonus error:', err);
      bot.sendMessage(chatId, 'Error claiming daily bonus. Try again later.');
    }
  });

  // ==================== NEW FEATURE COMMANDS ====================

  bot.onText(/^\/profile$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
    const totalBets = user.totalBets || 0;
    const totalWins = user.totalWins || 0;
    const winRate = calcWinRate(totalWins, totalBets);
    const vipStatus = isVipActive(user) ? '💎 ACTIVE' : 'Free';
    const vipBadge = isVipActive(user) ? ' 💎 VIP' : '';

    const menuKb = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };

    const text =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  👤 PROFILE${vipBadge}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🌟 ${getDisplayName(user)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 Joined    ${joinDate}\n` +
      `🎯 Bets      ${totalBets}\n` +
      `🏆 Wins      ${totalWins}\n` +
      `📊 Win Rate  ${winRate}\n` +
      `💎 VIP       ${vipStatus}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    await bot.sendMessage(chatId, text, { reply_markup: menuKb });
  });

  bot.onText(/^\/referral$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    const link = generateReferralLink(telegramId);
    const earnings = user.referralEarnings || 0;
    const count = user.referralCount || 0;

    const menuKb = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };

    const text =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  🎁 REFER & EARN\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Invite friends and earn coins!\n\n` +
      `💰 Your Referral Earnings: ${formatBalance(earnings)}\n` +
      `👥 Friends Joined: ${count}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📤 Your Referral Link:\n` +
      `${link}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 Share this link with friends.\n` +
      `When they join, you both get 500 coins!`;

    await bot.sendMessage(chatId, text, { reply_markup: menuKb });
  });

  bot.onText(/^\/vip$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    if (isVipActive(user)) {
      const expiry = user.vipExpiry ? new Date(user.vipExpiry).toLocaleDateString() : 'Lifetime';
      return await bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  💎 VIP ACTIVE\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `You are a VIP member!\n` +
        `📅 Expires: ${expiry}\n\n` +
        `✨ VIP Perks:\n` +
        `• 🎁 Double daily bonus\n` +
        `• 🔒 Access to VIP matches\n` +
        `• 🏆 Special leaderboard badge\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }

    const VIP_COST = parseInt(process.env.VIP_COST) || 5000;
    const VIP_DAYS = parseInt(process.env.VIP_DAYS) || 30;

    const text =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  💎 VIP PREMIUM\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✨ VIP Perks:\n` +
      `• 🎁 Double daily bonus\n` +
      `• 🔒 Access to VIP matches\n` +
      `• 🏆 Special leaderboard badge\n\n` +
      `💰 Cost: ${VIP_COST} coins\n` +
      `📅 Duration: ${VIP_DAYS} days\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Balance: ${formatBalance(user.balance)}\n\n` +
      `Tap Buy VIP to upgrade!`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: `💎 Buy VIP (${VIP_COST} coins)`, callback_data: 'buy_vip' },
          { text: '🔙 Back', callback_data: 'menu' }
        ]
      ]
    };

    await bot.sendMessage(chatId, text, { reply_markup: keyboard });
  });

  bot.onText(/^\/matches$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    const text =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  ⚽ MATCH CENTER\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Choose an option:`;
    const keyboard = {
      inline_keyboard: [
        [{ text: '📅 Upcoming', callback_data: 'matches_upcoming' }],
        [{ text: '🔴 Live Matches', callback_data: 'matches_live' }],
        [{ text: '🔴 Live Scores', callback_data: 'livescore' }],
        [{ text: '🔙 Main Menu', callback_data: 'menu' }]
      ]
    };
    await bot.sendMessage(chatId, text, { reply_markup: keyboard });
  });

  bot.onText(/^\/livescore$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    const all = await fetchUpcomingMatches();
    const live = all.filter(m => isMatchLive(m));
    if (!live.length) {
      const menuKb = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };
      return await bot.sendMessage(chatId, '🔴 No live matches right now.', { reply_markup: menuKb });
    }

    let text =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  🔴 LIVE SCORES (${live.length})\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const m of live) {
      const home = m.homeTeam?.shortName || m.homeTeam?.name || 'Home';
      const away = m.awayTeam?.shortName || m.awayTeam?.name || 'Away';
      const comp = m.competition?.code || '';
      const score = getLiveScore(m) || '0 - 0';
      text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `🔴 ${home} vs ${away}\n`;
      text += `   ⚽ ${score}  |  ${comp}\n`;
    }
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🔄 Live updates every 5 minutes`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔄 Refresh', callback_data: 'livescore' }],
        [{ text: '🔙 Main Menu', callback_data: 'menu' }]
      ]
    };
    await bot.sendMessage(chatId, text, { reply_markup: keyboard });
  });

  bot.onText(/^\/history$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await UserModel.findOne(telegramId);
    if (!user) return bot.sendMessage(chatId, 'Use /start first');

    const bets = await BetModel.findByTelegramId(telegramId);
    if (!bets.length) return bot.sendMessage(chatId, '📜 No bet history yet.\n\nUse /bet to place your first bet!');

    const recent = bets.slice(0, 10);
    let text =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  📜 BET HISTORY (Last ${recent.length})\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const b of recent) {
      const statusEmoji = b.status === 'EXACT' ? '⭐' : b.status === 'WON' ? '✅' : b.status === 'LOST' ? '❌' : '⏳';
      const teamName = b.prediction === 'HOME' ? b.homeTeam : b.prediction === 'AWAY' ? b.awayTeam : 'DRAW';
      const predEmoji = b.prediction === 'HOME' ? '🏠' : b.prediction === 'AWAY' ? '✈️' : '🤝';
      const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const scoreStr = b.predictedScore ? ` 🎯 ${b.predictedScore}` : '';
      const payoutStr = b.payout ? `  💰 +${b.payout}` : '';
      text += `${statusEmoji} ${b.homeTeam} vs ${b.awayTeam}  ${dateStr}\n`;
      text += `   ${predEmoji} ${teamName}${scoreStr}${payoutStr}\n\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📌 Total bets: ${bets.length}`;
    const menuKb = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };
    await bot.sendMessage(chatId, text, { reply_markup: menuKb });
  });

  bot.onText(/^\/admin$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    if (!isAdmin(telegramId)) return bot.sendMessage(chatId, 'Unauthorized');

    const totalUsers = await UserModel.count();
    const totalBets = await BetModel.count();
    const pendingDeposits = await DepositModel.countPending();
    const pendingWithdraws = await WithdrawModel.countPending();
    const totalCoins = await UserModel.aggregateTotalBalance();

    const text =
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  🔐 ADMIN PANEL\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📊 Bot Statistics:\n` +
      `👥 Users: ${totalUsers}\n` +
      `🎯 Bets: ${totalBets}\n` +
      `💰 Total Coins: ${totalCoins}\n` +
      `📥 Pending Deposits: ${pendingDeposits}\n` +
      `📤 Pending Withdraws: ${pendingWithdraws}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🛠 Commands:\n` +
      `/pending - View pending deposits\n` +
      `/approve <id> - Approve deposit\n` +
      `/reject <id> - Reject deposit\n` +
      `/users - List top users\n` +
      `/addcoins <id> <amt> - Add coins\n` +
      `/deductcoins <id> <amt> - Deduct coins\n` +
      `/settleall - Settle pending bets\n` +
      `/stats - Bot stats`;

    await bot.sendMessage(chatId, text);
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const state = userStates.get(telegramId);

    if (state && state.action === 'awaiting_bet_stake') {
      const parts = msg.text.trim().split(/\s+/);
      const stake = parseInt(parts[0]);
      const predictedScore = parts.length >= 2 ? parts[1] : null;
      const { matchId, prediction, matchData } = state.data;

      if (!stake || stake < 10) {
        return bot.sendMessage(chatId, '❌ Minimum stake is 10 coins. Format: <stake> <predicted-score>\nExample: 100 2-1');
      }

      // Validate score format if provided
      if (predictedScore && !/^\d+-\d+$/.test(predictedScore)) {
        return bot.sendMessage(chatId, '❌ Invalid score format. Use format: <homeGoals>-<awayGoals>\nExample: 100 2-1');
      }

      try {
        const bet = await placeBet(telegramId, matchId, prediction, stake, predictedScore);
        const home = matchData.homeTeam?.shortName || matchData.homeTeam?.name || 'Home';
        const away = matchData.awayTeam?.shortName || matchData.awayTeam?.name || 'Away';
        const teamName = prediction === 'HOME' ? home : prediction === 'AWAY' ? away : 'DRAW';
        const predEmoji = prediction === 'HOME' ? '🏠' : prediction === 'AWAY' ? '✈️' : '🤝';
        const scoreStr = predictedScore ? `\n🎯 Score: ${predictedScore}` : '';
        userStates.delete(telegramId);
        const doneKeyboard = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] };
        await bot.sendMessage(chatId,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  ✅ BET PLACED!\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `⚽ ${home} vs ${away}\n` +
          `${predEmoji} ${teamName}${scoreStr}\n` +
          `💰 Stake: ${stake} coins\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏆 Exact score → Double payout\n` +
          `👍 Correct outcome → 15% back\n` +
          `🍀 Good luck!`,
          { reply_markup: doneKeyboard });
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
      }
    }

    else if (state && state.action === 'awaiting_txid') {
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

      await WithdrawModel.create({
        telegramId: Number(telegramId),
        amount: Number(amount),
        username: msg.from.username || '',
        status: 'PENDING'
      });

      await UserModel.update(telegramId, {
        balance: (user.balance || 0) - amount
      });

      await bot.sendMessage(chatId, 
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
        `▰    ✅  *WITHDRAW SUBMITTED*  ▰\n` +
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
        `💰 Amount: *${amount} coins*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⏳ Admin will process it soon.`, 
        { parse_mode: 'Markdown' });
    } 

    else if (state && state.action === 'awaiting_deposit_amount') {
      const amount = parseInt(msg.text);
      if (!amount || amount < (parseInt(process.env.MIN_DEPOSIT) || 100)) {
        return bot.sendMessage(chatId, `❌ Minimum deposit is ${process.env.MIN_DEPOSIT || 100} coins.`);
      }
      userStates.set(telegramId, { action: 'awaiting_txid', data: { amount } });
      await bot.sendMessage(chatId,
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
        `▰     💵  *DEPOSIT ${amount}*      ▰\n` +
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
        `Send payment and reply with:\n` +
        `/txid YOUR_TXID ${amount}`, { parse_mode: 'Markdown' });
    } 
    else {
      await bot.sendMessage(chatId, 'Unknown command. Type /bet to see matches or /menu for main menu.');
    }
  });

  // Handle button clicks (Inline Keyboard)
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;

    console.log(`[CALLBACK] User: ${telegramId} | Data: ${data}`);

    try {
      if (data === 'balance') {
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');
        await bot.answerCallbackQuery(query.id);
        const msgText = 
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `▰      💰  *MY WALLET*     ▰\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
          `💳 Balance        ${escapeMarkdown(formatBalance(user.balance))}\n` +
          `📥 Deposited      ${String(user.totalDeposited || 0)}\n` +
          `🏆 Won from bets  ${String(user.totalWon || 0)}\n` +
          `🎯 Total bets     ${String(user.totalBets || 0)}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 *Net Profit:* ${String((user.totalWon || 0) - (user.totalDeposited || 0))} coins`;
        await bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
      }

      else if (data === 'deposit') {
        await bot.answerCallbackQuery(query.id);
        userStates.set(telegramId, { action: 'awaiting_deposit_amount' });

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
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `▰      💵  DEPOSIT COINS     ▰\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
          `Tap a quick amount below, or type your amount:`, 
          { reply_markup: depositKeyboard });
      }

      else if (data === 'mybets') {
        await bot.answerCallbackQuery(query.id);
        const bets = await getUserActiveBets(telegramId);
        if (bets.length === 0) {
          await bot.sendMessage(chatId, '📋 *No Active Bets*\n\nYou have no active bets.\nUse /bet to place one! 🎯');
        } else {
          let text = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  📋 MY ACTIVE BETS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
          bets.forEach((b) => {
            const teamName = b.prediction === 'HOME' ? b.homeTeam : b.prediction === 'AWAY' ? b.awayTeam : 'DRAW';
            const predEmoji = b.prediction === 'HOME' ? '🏠' : b.prediction === 'AWAY' ? '✈️' : '🤝';
            const scoreStr = b.predictedScore ? ` 🎯 ${b.predictedScore}` : '';
            text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            text += `⚽ ${b.homeTeam} vs ${b.awayTeam}\n`;
            text += `${predEmoji} ${teamName}${scoreStr}  •  💰 ${b.stake} coins\n`;
          });
          text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          text += `📌 Total Active: ${bets.length} bet(s)`;
          await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] } });
        }
      }

      else if (data === 'leaderboard') {
        await bot.answerCallbackQuery(query.id);
        const top = await UserModel.findTop(10);
        let text = `╔══════════════════════════════╗\n║      🏆 *TOP PLAYERS*         ║\n╚══════════════════════════════╝\n\n`;
        const medals = ['🥇', '🥈', '🥉'];
        top.forEach((u, i) => {
          const medal = medals[i] || `${i+1}.`;
          const name = escapeMarkdown(getDisplayName(u));
          text += `${medal} ${name}  —  💰 ${formatBalance(u.balance)}\n`;
        });
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }

      else if (data === 'bet') {
        await bot.answerCallbackQuery(query.id);
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');

        const text =
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  🎯 PLACE BET\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Step 1: Select a league`;
        await bot.sendMessage(chatId, text, { reply_markup: buildLeagueKeyboard('league_bet') });
      }

      else if (data.startsWith('league_bet_')) {
        await bot.answerCallbackQuery(query.id);
        const code = data.replace('league_bet_', '');
        const league = LEAGUES.find(l => l.code === code);
        if (!league) return bot.sendMessage(chatId, 'League not found.');

        const matches = await getMatchesByCompetition(code);
        const bettable = matches.filter(m => canBetOnMatch(m));

        if (!bettable.length) {
          return bot.sendMessage(chatId, `No bettable matches in ${league.emoji} ${league.name} right now.`);
        }

        const user = await UserModel.findOne(telegramId);
        let text =
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  🎯 ${league.emoji} ${league.name}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Select a match to bet on:\n\n`;
        const keyboard = [];
        bettable.forEach((m, i) => {
          const home = m.homeTeam?.shortName || m.homeTeam?.name || 'Home';
          const away = m.awayTeam?.shortName || m.awayTeam?.name || 'Away';
          const date = new Date(m.utcDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          text += `${i + 1}. ${home} vs ${away}\n   🕒 ${date}\n\n`;
          keyboard.push([{ text: `✅ ${home} vs ${away}`, callback_data: `match_${m.id}` }]);
        });
        text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💰 Balance: ${user ? formatBalance(user.balance) : '0'}`;
        keyboard.push([{ text: '🔙 Back to Leagues', callback_data: 'bet' }]);
        keyboard.push([{ text: '🔙 Main Menu', callback_data: 'menu' }]);
        await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
      }

      else if (data.startsWith('page_')) {
        await bot.answerCallbackQuery(query.id);
        const page = parseInt(data.replace('page_', ''));
        const state = userStates.get(telegramId);
        if (state && state.action === 'browsing_matches' && state.matches) {
          await showMatchPage(chatId, telegramId, state.matches, page);
        } else {
          const matches = await fetchUpcomingMatches();
          if (matches.length) {
            userStates.set(telegramId, { action: 'browsing_matches', matches, page });
            await showMatchPage(chatId, telegramId, matches, page);
          }
        }
      }

      else if (data === 'noop') {
        await bot.answerCallbackQuery(query.id, { text: 'This match is not available for betting.' });
      }

      else if (data.startsWith('match_')) {
        await bot.answerCallbackQuery(query.id);
        const matchId = parseInt(data.replace('match_', ''));
        const matchData = await fetchMatchById(matchId);
        if (!matchData) return bot.sendMessage(chatId, 'Match not found.');

        const home = matchData.homeTeam?.shortName || matchData.homeTeam?.name || 'Home';
        const away = matchData.awayTeam?.shortName || matchData.awayTeam?.name || 'Away';
        const date = new Date(matchData.utcDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const comp = matchData.competition?.code || '';
        const user = await UserModel.findOne(telegramId);

        const live = matchData.status === 'LIVE' || matchData.status === 'IN_PLAY';
        const bettable = matchData.status === 'SCHEDULED' || matchData.status === 'TIMED';
        const header = live ? '🔴 LIVE MATCH' : bettable ? '⚽ MATCH INFO' : '⏰ BET CLOSED';

        const text = 
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  ${header}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🏠 ${home}\n` +
          `🤝  vs\n` +
          `✈️ ${away}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 ${date}\n` +
          `🏆 ${comp}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💰 Balance: ${user ? formatBalance(user.balance) : '0'}\n\n` +
          `🎯 Pick your prediction:`;

        const keyboard = { inline_keyboard: [[]] };
        if (bettable) {
          keyboard.inline_keyboard = [
            [
              { text: `🏠 ${home}`, callback_data: `predict_${matchId}_HOME` },
              { text: `🤝 DRAW`, callback_data: `predict_${matchId}_DRAW` },
              { text: `✈️ ${away}`, callback_data: `predict_${matchId}_AWAY` }
            ],
            [{ text: '🔙 Back to matches', callback_data: 'bet' }]
          ];
        } else {
          keyboard.inline_keyboard = [
            [{ text: '🔙 Back to matches', callback_data: 'bet' }]
          ];
        }

        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
      }

      else if (data.startsWith('predict_')) {
        await bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const matchId = parseInt(parts[1]);
        const prediction = parts[2];
        const matchData = await fetchMatchById(matchId);
        if (!matchData) return bot.sendMessage(chatId, 'Match not found.');

        const home = matchData.homeTeam?.shortName || matchData.homeTeam?.name || 'Home';
        const away = matchData.awayTeam?.shortName || matchData.awayTeam?.name || 'Away';
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');

        userStates.set(telegramId, {
          action: 'awaiting_bet_stake',
          data: { matchId, prediction, matchData }
        });

        const teamName = prediction === 'HOME' ? home : prediction === 'AWAY' ? away : 'DRAW';
        const predEmoji = prediction === 'HOME' ? '🏠' : prediction === 'AWAY' ? '✈️' : '🤝';
        await bot.sendMessage(chatId,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  🎯 PLACE BET\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `⚽ ${home} vs ${away}\n` +
          `${predEmoji} ${teamName}\n` +
          `💰 Balance: ${formatBalance(user.balance)}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Reply with: <stake> <predicted-score>\n\n` +
          `Example: \`100 2-1\`\n\n` +
          `🏆 EXACT score = DOUBLE payout\n` +
          `👍 Correct outcome = 15% back\n` +
          `❌ Wrong = Stake lost\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Minimum stake: 10 coins`);
      }

      else if (data === 'profile') {
        await bot.answerCallbackQuery(query.id);
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');
        const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
        const totalBets = user.totalBets || 0;
        const totalWins = user.totalWins || 0;
        const winRate = calcWinRate(totalWins, totalBets);
        const vipStatus = isVipActive(user) ? '💎 ACTIVE' : 'Free';
        const vipBadge = isVipActive(user) ? ' 💎 VIP' : '';
        await bot.sendMessage(chatId,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  👤 PROFILE${vipBadge}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🌟 ${getDisplayName(user)}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 Joined    ${joinDate}\n` +
          `🎯 Bets      ${totalBets}\n` +
          `🏆 Wins      ${totalWins}\n` +
          `📊 Win Rate  ${winRate}\n` +
          `💎 VIP       ${vipStatus}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          { reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] } });
      }

      else if (data === 'referral') {
        await bot.answerCallbackQuery(query.id);
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');
        const link = generateReferralLink(telegramId);
        const earnings = user.referralEarnings || 0;
        const count = user.referralCount || 0;
        await bot.sendMessage(chatId,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  🎁 REFER & EARN\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Invite friends and earn coins!\n\n` +
          `💰 Earnings: ${formatBalance(earnings)}\n` +
          `👥 Friends: ${count}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📤 Your Link:\n${link}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Share with friends. Both get 500 coins!`,
          { reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] } });
      }

      else if (data === 'vip') {
        await bot.answerCallbackQuery(query.id);
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');
        if (isVipActive(user)) {
          const expiry = user.vipExpiry ? new Date(user.vipExpiry).toLocaleDateString() : 'Lifetime';
          return await bot.sendMessage(chatId,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `  💎 VIP ACTIVE\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `You are a VIP member!\n` +
            `📅 Expires: ${expiry}\n\n` +
            `✨ Perks:\n` +
            `• 🎁 Double daily bonus\n` +
            `• 🔒 VIP matches access\n` +
            `• 🏆 Special badge`,
            { reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] } });
        }
        const VIP_COST = parseInt(process.env.VIP_COST) || 5000;
        const VIP_DAYS = parseInt(process.env.VIP_DAYS) || 30;
        const keyboard = {
          inline_keyboard: [
            [{ text: `💎 Buy VIP (${VIP_COST} coins)`, callback_data: 'buy_vip' }],
            [{ text: '🔙 Back', callback_data: 'menu' }]
          ]
        };
        await bot.sendMessage(chatId,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  💎 VIP PREMIUM\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `✨ Perks:\n` +
          `• 🎁 Double daily bonus\n` +
          `• 🔒 VIP matches access\n` +
          `• 🏆 Special badge\n\n` +
          `💰 Cost: ${VIP_COST} coins\n` +
          `📅 Duration: ${VIP_DAYS} days\n\n` +
          `Balance: ${formatBalance(user.balance)}`,
          { reply_markup: keyboard });
      }

      else if (data === 'buy_vip') {
        await bot.answerCallbackQuery(query.id);
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');
        if (isVipActive(user)) return bot.sendMessage(chatId, 'You already have VIP!');
        const VIP_COST = parseInt(process.env.VIP_COST) || 5000;
        const VIP_DAYS = parseInt(process.env.VIP_DAYS) || 30;
        if (user.balance < VIP_COST) return bot.sendMessage(chatId, `Insufficient balance. VIP costs ${VIP_COST} coins.`);
        const expiry = Date.now() + VIP_DAYS * 24 * 60 * 60 * 1000;
        await UserModel.update(telegramId, {
          balance: user.balance - VIP_COST,
          vip: true,
          vipExpiry: expiry
        });
        await bot.sendMessage(chatId, `💎 Congratulations! You are now VIP for ${VIP_DAYS} days!\n\nEnjoy your premium perks!`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] } });
      }

      else if (data === 'matches') {
        await bot.answerCallbackQuery(query.id);
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');
        const text =
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  ⚽ MATCH CENTER\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Choose an option:`;
        const keyboard = {
          inline_keyboard: [
            [{ text: '📅 Upcoming', callback_data: 'matches_upcoming' }],
            [{ text: '🔴 Live Matches', callback_data: 'matches_live' }],
            [{ text: '🔴 Live Scores', callback_data: 'livescore' }],
            [{ text: '🔙 Main Menu', callback_data: 'menu' }]
          ]
        };
        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
      }

      else if (data === 'matches_upcoming') {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  📅 UPCOMING MATCHES\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Select a league:`,
          { reply_markup: buildLeagueKeyboard('league_matches') });
      }

      else if (data === 'matches_live') {
        await bot.answerCallbackQuery(query.id);
        const all = await fetchUpcomingMatches();
        const live = all.filter(m => isMatchLive(m));
        if (!live.length) return bot.sendMessage(chatId, '🔴 No live matches right now.');
        let text =
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  🔴 LIVE MATCHES (${live.length})\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        live.forEach((m, i) => {
          text += formatMatchLine(m, i + 1) + '\n';
        });
        const keyboard = {
          inline_keyboard: [
            [{ text: '🔴 Live Scores', callback_data: 'livescore' }],
            [{ text: '🔙 Back', callback_data: 'matches' }],
            [{ text: '🔙 Main Menu', callback_data: 'menu' }]
          ]
        };
        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
      }

      else if (data === 'livescore') {
        await bot.answerCallbackQuery(query.id);
        const all = await fetchUpcomingMatches();
        const live = all.filter(m => isMatchLive(m));
        if (!live.length) return bot.sendMessage(chatId, '🔴 No live matches right now.');
        let text =
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  🔴 LIVE SCORES (${live.length})\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const m of live) {
          const home = m.homeTeam?.shortName || m.homeTeam?.name || 'Home';
          const away = m.awayTeam?.shortName || m.awayTeam?.name || 'Away';
          const comp = m.competition?.code || '';
          const score = getLiveScore(m) || '0 - 0';
          text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          text += `🔴 ${home} vs ${away}\n`;
          text += `   ⚽ ${score}  |  ${comp}\n`;
        }
        text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `🔄 Live updates every 5 minutes`;
        const keyboard = {
          inline_keyboard: [
            [{ text: '🔄 Refresh', callback_data: 'livescore' }],
            [{ text: '🔙 Matches', callback_data: 'matches' }],
            [{ text: '🔙 Main Menu', callback_data: 'menu' }]
          ]
        };
        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
      }

      else if (data.startsWith('league_matches_')) {
        await bot.answerCallbackQuery(query.id);
        const code = data.replace('league_matches_', '');
        const league = LEAGUES.find(l => l.code === code);
        if (!league) return bot.sendMessage(chatId, 'League not found.');
        const matches = await getMatchesByCompetition(code);
        if (!matches.length) return bot.sendMessage(chatId, `No upcoming matches in ${league.emoji} ${league.name}.`);
        let text =
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  ${league.emoji} ${league.name}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        matches.forEach((m, i) => {
          text += formatMatchLine(m, i + 1) + '\n';
        });
        text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎯 Use Place Bet to bet on these matches!`;
        const keyboard = {
          inline_keyboard: [
            [{ text: '🔙 Back to Leagues', callback_data: 'matches_upcoming' }],
            [{ text: '🔙 Main Menu', callback_data: 'menu' }]
          ]
        };
        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
      }

      else if (data === 'history') {
        await bot.answerCallbackQuery(query.id);
        const user = await UserModel.findOne(telegramId);
        if (!user) return bot.sendMessage(chatId, 'Use /start first');
        const bets = await BetModel.findByTelegramId(telegramId);
        if (!bets.length) return bot.sendMessage(chatId, '📜 No bet history yet.');
        const recent = bets.slice(0, 10);
        let text =
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `  📜 BET HISTORY (Last ${recent.length})\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const b of recent) {
          const statusEmoji = b.status === 'EXACT' ? '⭐' : b.status === 'WON' ? '✅' : b.status === 'LOST' ? '❌' : '⏳';
          const teamName = b.prediction === 'HOME' ? b.homeTeam : b.prediction === 'AWAY' ? b.awayTeam : 'DRAW';
          const predEmoji = b.prediction === 'HOME' ? '🏠' : b.prediction === 'AWAY' ? '✈️' : '🤝';
          const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
          const scoreStr = b.predictedScore ? ` 🎯 ${b.predictedScore}` : '';
          const payoutStr = b.payout ? `  💰 +${b.payout}` : '';
          text += `${statusEmoji} ${b.homeTeam} vs ${b.awayTeam}  ${dateStr}\n`;
          text += `   ${predEmoji} ${teamName}${scoreStr}  ${payoutStr}\n\n`;
        }
        text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📌 Total: ${bets.length} bets`;
        await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] } });
      }

      else if (data === 'help') {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, 'Use /help to see all commands or visit the menu.');
      }

      else if (data === 'daily') {
        await bot.answerCallbackQuery(query.id);
        // Re-trigger the /daily command logic inline
        try {
          const user = await UserModel.findOne(telegramId);
          if (!user) return bot.sendMessage(chatId, 'Use /start first');
          const now = Date.now();
          const last = user.lastDailyClaim || 0;
          const DAY_MS = 24 * 60 * 60 * 1000;
          if (now - last < DAY_MS) {
            const remaining = DAY_MS - (now - last);
            const hours = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            return bot.sendMessage(chatId, `⏳ You already claimed today.\nCome back in ${hours}h ${mins}m.`);
          }
          const BONUS = isVipActive(user) ? 1.0 : 0.5;
          const newBal = (user.balance || 0) + BONUS;
          await UserModel.update(telegramId, { balance: newBal, lastDailyClaim: now });
          const vipMsg = isVipActive(user) ? ' (VIP Double Bonus!)' : '';
          await bot.sendMessage(chatId, `🎁 Daily Bonus Claimed${vipMsg}!\n\nYou received +${BONUS} coins\nNew balance: ${newBal} coins\n\nCome back tomorrow for another bonus.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'menu' }]] } });
        } catch (err) {
          console.error('Daily bonus error:', err);
          bot.sendMessage(chatId, 'Error claiming daily bonus. Try again later.');
        }
      }

      else if (data === 'menu') {
        await bot.answerCallbackQuery(query.id);
        userStates.delete(telegramId);
        await sendMainMenu(chatId, telegramId);
      }

      else if (data === 'withdraw') {
        await bot.answerCallbackQuery(query.id);
        userStates.set(telegramId, { action: 'awaiting_withdraw_amount' });
        await bot.sendMessage(chatId,
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `▰      💸  *WITHDRAW COINS*    ▰\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
          `Reply with the amount to withdraw:\n\n` +
          `Example: \`500\`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📌 Minimum: *100 coins*\n` +
          `⏳ Manual processing by admin`);
      }

      else if (data.startsWith('quick_deposit_')) {
        const amount = parseInt(data.replace('quick_deposit_', ''));
        await bot.answerCallbackQuery(query.id);
        const method = process.env.PAYMENT_METHOD || 'bKash/Nagad';
        const number = process.env.PAYMENT_NUMBER || '01XXXXXXXXX';
        userStates.set(telegramId, { action: 'awaiting_txid', data: { amount } });
        await bot.sendMessage(chatId, 
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `▰     💵  DEPOSIT REQUEST   ▰\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
          `💰 Amount: ${amount} coins\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Send exactly ${amount} BDT to:\n\n` +
          `📱 ${method}: ${number}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `After payment, reply with:\n` +
          `/txid YOUR_TXID ${amount}\n\n` +
          `Example: /txid 8K7P9Q2R ${amount}`);
      }

      else if (data === 'deposit_custom') {
        await bot.answerCallbackQuery(query.id);
        userStates.set(telegramId, { action: 'awaiting_deposit_amount' });
        await bot.sendMessage(chatId,
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
          `▰    💵  CUSTOM DEPOSIT     ▰\n` +
          `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
          `Type the amount you want to deposit\n(e.g. 750):`);
      }
    } catch (err) {
      console.error('Callback query error:', err);
      await bot.answerCallbackQuery(query.id, { text: 'Error occurred' });
    }
  });
}

  function buildLeagueKeyboard(prefix) {
    const rows = [];
    for (let i = 0; i < LEAGUES.length; i += 2) {
      const row = [];
      row.push({ text: `${LEAGUES[i].emoji} ${LEAGUES[i].name}`, callback_data: `${prefix}_${LEAGUES[i].code}` });
      if (i + 1 < LEAGUES.length) {
        row.push({ text: `${LEAGUES[i+1].emoji} ${LEAGUES[i+1].name}`, callback_data: `${prefix}_${LEAGUES[i+1].code}` });
      }
      rows.push(row);
    }
    rows.push([{ text: '🔙 Back to Menu', callback_data: 'menu' }]);
    return { inline_keyboard: rows };
  }

  function formatMatchLine(m, index) {
    const home = m.homeTeam?.shortName || m.homeTeam?.name || 'Home';
    const away = m.awayTeam?.shortName || m.awayTeam?.name || 'Away';
    const date = new Date(m.utcDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const comp = m.competition?.code || '';
    const live = isMatchLive(m);
    const score = live ? getLiveScore(m) : null;
    const scoreStr = score ? ` ⚽ ${score}` : '';
    const statusStr = live ? (score ? `🔴 ${score}` : '🔴 LIVE') : '🕒 ' + date;
    return `${live ? '🔴' : index}. ${home} vs ${away}\n   ${statusStr} | ${comp}\n`;
  }

  // ==================== PREMIUM MAIN MENU ====================
async function sendMainMenu(chatId, telegramId) {
  const user = await UserModel.findOne(telegramId);
  const balanceText = user ? formatBalance(user.balance) : '0 coins';
  const displayName = getDisplayName(user);
  const totalBets = user?.totalBets || 0;
  const totalWon = user?.totalWon || 0;
  const vipBadge = isVipActive(user) ? ' 💎VIP' : '';

  const text = 
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `  ⚽ GoalX AI${vipBadge}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🌟 ${displayName}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Account Overview\n` +
    `   💰 Balance    ${balanceText}\n` +
    `   🎯 Bets       ${String(totalBets).padStart(6)} placed\n` +
    `   🏆 Won        ${formatBalance(totalWon)}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎮 Menu`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💰 Balance', callback_data: 'balance' },
        { text: '💳 Deposit', callback_data: 'deposit' }
      ],
      [
        { text: '⚽ Matches', callback_data: 'matches' },
        { text: '🎯 Place Bet', callback_data: 'bet' }
      ],
      [
        { text: '🔴 Live Scores', callback_data: 'livescore' },
        { text: '📜 My Bets', callback_data: 'mybets' }
      ],
      [
        { text: '🏆 Leaderboard', callback_data: 'leaderboard' }
      ],
      [
        { text: '🎁 Referral', callback_data: 'referral' },
        { text: '🎁 Daily', callback_data: 'daily' }
      ],
      [
        { text: '💎 VIP', callback_data: 'vip' },
        { text: '🔄 Refresh', callback_data: 'menu' }
      ],
      [
        { text: '❓ Help', callback_data: 'help' },
        { text: '👤 Profile', callback_data: 'profile' }
      ]
    ]
  };

  await bot.sendMessage(chatId, text, {
    reply_markup: keyboard
  });
}


module.exports = { initBot, getBot: () => bot };
