# Football Coin Predictor Bot

A production-ready Telegram bot for virtual coin-based football match predictions. Users register, deposit via manual approval, bet virtual coins on real football matches fetched from football-data.org API, and win/lose coins based on outcomes.

**NOT real money gambling** - Purely virtual entertainment system with manual deposit verification.

## Features
- Auto user registration on `/start`
- Virtual coin balance system
- Manual deposit via bKash/Nagad with admin approval
- Real upcoming football matches from API
- Bet on Home / Draw / Away with coin stakes
- Automatic bet settlement when matches finish
- Leaderboard of top players
- Full admin controls via Telegram commands
- Secure balance handling, duplicate prevention

## Tech Stack
- Node.js + Express
- node-telegram-bot-api
- Mongoose + MongoDB
- Axios + football-data.org API
- node-cron for scheduled settlements

## Project Structure
```
.
├── server.js              # Main entry point
├── config/
│   └── db.js              # MongoDB connection
├── models/
│   ├── User.js
│   ├── Bet.js
│   └── Deposit.js
├── services/
│   ├── footballService.js # Football API integration + caching
│   └── bettingService.js  # Core betting & settlement logic
├── bot/
│   └── telegramBot.js     # All Telegram command & callback handlers
├── utils/
│   └── helpers.js         # Utility functions
├── routes/
│   └── admin.js           # Optional REST admin endpoints (future)
├── public/                # Static files (if any)
├── .env                   # Your secrets (never commit)
├── .env.example
├── package.json
└── README.md
```

## Setup Instructions

### 1. Prerequisites
- Node.js >= 18
- MongoDB Atlas account (free tier)
- Telegram account + @BotFather to create bot
- football-data.org free API key (register at https://www.football-data.org/client/register)

### 2. Clone & Install
```bash
git clone <your-repo>
cd football-coin-predictor-bot
npm install
cp .env.example .env
```

### 3. Configure Environment
Edit `.env`:
- `TELEGRAM_BOT_TOKEN` = token from BotFather
- `MONGODB_URI` = your Atlas connection string
- `FOOTBALL_API_KEY`
- `ADMIN_USER_IDS` = your Telegram numeric ID (use @userinfobot or ask bot to log it)

### 4. Run Locally
```bash
npm run dev   # with nodemon
# or
npm start
```

The bot will start polling. Open Telegram, find your bot, send `/start`

### 5. Production Deployment (Free)

#### Option A: Railway.app (recommended for bots)
1. Push code to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables from .env
4. It auto-detects Node, runs `npm start`
5. Get public URL, set Telegram webhook (see below) or keep polling (Railway allows long running)

#### Option B: Render.com
1. Create Web Service
2. Connect repo
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Add env vars
6. Free tier sleeps after 15min inactivity — for bots better use paid or ping service, or implement webhook + cron wake

#### Important for Production:
- Switch bot to **webhook** mode for reliability:
  In `server.js` or bot init, use:
  ```js
  bot.setWebHook(`${process.env.RENDER_EXTERNAL_URL || 'https://yourdomain'}/bot${TOKEN}`)
  ```
  And add Express route to handle updates:
  `app.post(`/bot${TOKEN}`, (req, res) => bot.processUpdate(req.body))`

- Set up MongoDB Atlas with IP whitelist or 0.0.0.0/0 for Render/Railway

- Monitor logs for API rate limits (football-data free: ~10 calls/min)

## Bot Commands (for Users)
| Command          | Description                              |
|------------------|------------------------------------------|
| `/start`         | Register / welcome + get 1000 coins      |
| `/balance`       | Show your current coin balance           |
| `/deposit <amt>` | Get payment instructions for depositing  |
| `/txid <id> <amt>` | Submit transaction ID after payment    |
| `/bet`           | List upcoming matches + how to bet       |
| `/mybets`        | Show your active (unsettled) bets        |
| `/leaderboard`   | Top 10 richest players                   |
| `/help`          | Show all commands                        |

**How to bet example:**
1. `/bet` → bot shows matches e.g. `1. Arsenal vs Man City (ID:12345)`
2. Reply: `/bet 12345 home 200` (bet 200 coins on Arsenal win)
3. Or use follow-up prompts

## Admin Commands (only for ADMIN_USER_IDS)
| Command                    | Description                              |
|----------------------------|------------------------------------------|
| `/pending`                 | List all pending deposits                |
| `/approve <depositId>`     | Approve a deposit, add coins to user     |
| `/reject <depositId>`      | Reject a deposit                         |
| `/users`                   | List recent users + balances             |
| `/addcoins <userId> <amt>` | Manually credit coins to a user          |
| `/deductcoins <userId> <amt>` | Manually deduct coins                 |
| `/settleall`               | Force check and settle all finished bets |
| `/stats`                   | Show bot statistics (total users, bets)  |

## HTML Admin Panel (Web Dashboard)

A clean, mobile-friendly admin dashboard is included at:

**http://localhost:3000/admin**   (or your deployed domain /admin)

- View & approve/reject pending deposits with one click
- See all users sorted by balance
- Manually add or deduct coins
- One-click force bet settlement
- Protected by `ADMIN_API_TOKEN` from `.env`

Just open the page, paste your admin token when prompted. The panel talks to the same Node.js server.

This is the **only** web UI — normal users still use only Telegram.

## Database Schema (Mongoose)

**User**
- telegramId (unique)
- username
- firstName
- balance (Number, default 1000)
- totalDeposited
- totalWon
- createdAt

**Bet**
- userId (ref User)
- matchId (from football API)
- homeTeam, awayTeam
- prediction ("HOME" | "DRAW" | "AWAY")
- stake (coins)
- status ("PENDING" | "WON" | "LOST")
- result (actual outcome)
- payout (if won)
- createdAt, settledAt

**Deposit**
- userId
- amount
- txid
- status ("PENDING" | "APPROVED" | "REJECTED")
- approvedBy (admin id)
- createdAt

## Football API Usage
- Fetches scheduled matches for popular competitions (Premier League, Champions League, etc.)
- Updates every 10 minutes via cron
- Caches in memory to reduce API calls
- On settlement: fetches specific match details for score

## Important Rules & Security
- All bets are virtual coins only
- Coins only added on manual admin approval of real payment proof
- No auto-deposits, no crypto, no payment gateways
- One active bet per match per user
- Balance never goes negative
- All settlements are atomic in DB
- Admin actions logged in console

## Customization
- Change `PAYMENT_INSTRUCTIONS` in .env
- Add more leagues in `footballService.js` (competition IDs)
- Change reward multiplier (currently x2 for correct bet)
- Add more admin features or web dashboard later

## Scaling Notes
- For 1000+ users: use Redis for user state, queue for settlements
- Move cron to separate worker if needed
- Add rate limiting on bot commands
- Use webhooks + PM2 / Docker

## License
MIT - For personal / educational use. Do not use for real-money gambling without proper licenses.

## Support
Report issues on GitHub or contact admin.

Enjoy predicting responsibly!
