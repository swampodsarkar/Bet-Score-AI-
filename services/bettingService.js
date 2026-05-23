const BetModel = require('../models/Bet');
const UserModel = require('../models/User');
const { fetchMatchById } = require('./footballService');

async function placeBet(telegramId, matchId, prediction, stake, predictedScore) {
  const user = await UserModel.findOne(telegramId);
  if (!user) throw new Error('User not found');
  if (user.balance < stake) throw new Error('Insufficient balance');

  const existingBets = await BetModel.findPendingByTelegramId(telegramId);
  const hasExisting = existingBets.some(b => b.matchId === Number(matchId));
  if (hasExisting) throw new Error('You already have a pending bet on this match');

  const matchData = await fetchMatchById(matchId);
  if (!matchData) throw new Error('Match not found or API error');

  const { isMatchLive, canBetOnMatch } = require('./footballService');
  if (isMatchLive(matchData)) throw new Error('Match is LIVE — betting closed');
  if (!canBetOnMatch(matchData)) throw new Error('Betting closed (match starts in < 15 min or already started)');

  const homeTeam = matchData.homeTeam?.name || 'Home';
  const awayTeam = matchData.awayTeam?.name || 'Away';

  const bet = await BetModel.create({
    telegramId: Number(telegramId),
    matchId: Number(matchId),
    homeTeam,
    awayTeam,
    prediction,
    stake: Number(stake),
    predictedScore: predictedScore || null,
    status: 'PENDING'
  });

  await UserModel.update(telegramId, {
    balance: user.balance - stake,
    totalBets: (user.totalBets || 0) + 1
  });

  return bet;
}

async function settleBet(bet, matchData) {
  if (!matchData || matchData.status !== 'FINISHED') return false;

  const homeGoals = matchData.score?.fullTime?.home ?? matchData.score?.regularTime?.home ?? 0;
  const awayGoals = matchData.score?.fullTime?.away ?? matchData.score?.regularTime?.away ?? 0;

  let actualResult;
  if (homeGoals > awayGoals) actualResult = 'HOME';
  else if (awayGoals > homeGoals) actualResult = 'AWAY';
  else actualResult = 'DRAW';

  const user = await UserModel.findOne(bet.telegramId);
  if (!user) return false;

  let payout = 0;
  let newStatus = 'LOST';
  let payoutLabel = '';

  if (actualResult === bet.prediction) {
    // Check for exact score match
    const isExact = bet.predictedScore && bet.predictedScore === `${homeGoals}-${awayGoals}`;

    if (isExact) {
      // EXACT score match: double payout
      payout = bet.stake * 2;
      newStatus = 'EXACT';
      payoutLabel = `EXACT SCORE! ${bet.predictedScore} ✅`;
    } else {
      // CLOSE: correct outcome but wrong score → 15% back
      payout = Math.round(bet.stake * 0.15);
      newStatus = 'WON';
      payoutLabel = `Close! Outcome correct (${bet.prediction})`;
    }

    await UserModel.update(bet.telegramId, {
      balance: user.balance + payout,
      totalWon: (user.totalWon || 0) + payout,
      totalWins: (user.totalWins || 0) + 1
    });
  }

  await BetModel.update(bet.id, {
    status: newStatus,
    actualResult,
    payout,
    settledAt: new Date().toISOString()
  });

  // Notify user about settlement
  try {
    const bot = require('../bot/telegramBot').getBot();
    if (bot) {
      const teamDisplay = `${bet.homeTeam} vs ${bet.awayTeam}`;
      const predEmoji = bet.prediction === 'HOME' ? '🏠' : bet.prediction === 'AWAY' ? '✈️' : '🤝';
      const resultEmoji = actualResult === 'HOME' ? '🏠' : actualResult === 'AWAY' ? '✈️' : '🤝';
      const scoreLine = `${homeGoals} - ${awayGoals}`;
      let msg;
      if (newStatus === 'EXACT') {
        msg = `⭐ EXACT SCORE WIN!\n\n⚽ ${teamDisplay}\n📊 ${scoreLine}\n${predEmoji} Your pick: ${bet.prediction}\n💰 Double Payout: +${payout} coins`;
      } else if (newStatus === 'WON') {
        const scoreStr = bet.predictedScore ? ` (predicted: ${bet.predictedScore})` : '';
        msg = `✅ BET CLOSE-WIN!\n\n⚽ ${teamDisplay}\n📊 ${scoreLine}\n${predEmoji} Outcome correct: ${bet.prediction}${scoreStr}\n💰 15% Return: +${payout} coins`;
      } else {
        const scoreStr = bet.predictedScore ? ` (predicted: ${bet.predictedScore})` : '';
        msg = `❌ BET LOST\n\n⚽ ${teamDisplay}\n📊 ${scoreLine}\n${predEmoji} Your pick: ${bet.prediction}${scoreStr}\n😢 Stake lost: ${bet.stake} coins`;
      }
      await bot.sendMessage(bet.telegramId, msg);
    }
  } catch (e) { /* notification best-effort */ }

  return true;
}

async function settlePendingBets() {
  const pendingBets = await BetModel.findPending();
  if (pendingBets.length === 0) return 0;

  const now = new Date();
  const lookback = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const finishedMatches = await require('./footballService').getFinishedMatchesSince(lookback);
  const matchMap = new Map(finishedMatches.map(m => [m.id, m]));

  let settledCount = 0;

  for (const bet of pendingBets) {
    const matchData = matchMap.get(Number(bet.matchId));
    if (matchData) {
      const settled = await settleBet(bet, matchData);
      if (settled) settledCount++;
    }
  }

  return settledCount;
}

async function getUserActiveBets(telegramId) {
  const bets = await BetModel.findPendingByTelegramId(telegramId);
  return bets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function cancelBet(telegramId, betId) {
  const bet = await BetModel.findById(betId);
  if (!bet) throw new Error('Bet not found');
  if (Number(bet.telegramId) !== Number(telegramId)) throw new Error('This bet does not belong to you');
  if (bet.status !== 'PENDING') throw new Error('Bet is already settled or cancelled');

  const matchData = await fetchMatchById(bet.matchId);
  if (matchData) {
    const { canBetOnMatch } = require('./footballService');
    if (!canBetOnMatch(matchData)) throw new Error('Match has already started or too close to kickoff - cannot cancel');
  }

  const user = await UserModel.findOne(telegramId);
  if (!user) throw new Error('User not found');

  await UserModel.update(telegramId, {
    balance: (user.balance || 0) + bet.stake,
    totalBets: Math.max(0, (user.totalBets || 0) - 1)
  });

  await BetModel.update(betId, {
    status: 'CANCELLED',
    settledAt: new Date().toISOString()
  });

  return bet;
}

module.exports = {
  placeBet,
  settlePendingBets,
  getUserActiveBets,
  cancelBet
};
