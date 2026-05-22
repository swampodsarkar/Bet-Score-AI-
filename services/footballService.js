const axios = require('axios');

const API_KEY = process.env.FOOTBALL_API_KEY;
const BASE_URL = 'https://api.football-data.org/v4';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-Auth-Token': API_KEY
  },
  timeout: 10000
});

let cachedMatches = [];
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000;

const POPULAR_COMPETITIONS = 'PL,CL,PD,SA,BL1,FL1,DED,ELC';

async function fetchUpcomingMatches() {
  const now = Date.now();
  if (cachedMatches.length > 0 && (now - lastFetch) < CACHE_TTL) {
    return cachedMatches;
  }

  try {
    const today = new Date();
    const future = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = future.toISOString().split('T')[0];

    const response = await api.get('/matches', {
      params: {
        competitions: POPULAR_COMPETITIONS,
        dateFrom,
        dateTo,
        status: 'SCHEDULED',
        limit: 50
      }
    });

    cachedMatches = response.data.matches || [];
    lastFetch = now;
    return cachedMatches;
  } catch (error) {
    console.error('Football API error (upcoming):', error.response?.data || error.message);
    return cachedMatches.length > 0 ? cachedMatches : [];
  }
}

async function fetchMatchById(matchId) {
  try {
    const response = await api.get(`/matches/${matchId}`);
    return response.data;
  } catch (error) {
    console.error(`Football API error (match ${matchId}):`, error.response?.data || error.message);
    return null;
  }
}

async function getFinishedMatchesSince(dateFrom) {
  try {
    const response = await api.get('/matches', {
      params: {
        competitions: POPULAR_COMPETITIONS,
        dateFrom,
        status: 'FINISHED',
        limit: 100
      }
    });
    return response.data.matches || [];
  } catch (error) {
    console.error('Football API error (finished):', error.response?.data || error.message);
    return [];
  }
}

function formatMatchForUser(match) {
  const home = match.homeTeam?.shortName || match.homeTeam?.name || 'Home';
  const away = match.awayTeam?.shortName || match.awayTeam?.name || 'Away';
  const date = new Date(match.utcDate).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const comp = match.competition?.code || '';
  return `${home} vs ${away} | ${date} | ${comp} | ID:${match.id}`;
}

module.exports = {
  fetchUpcomingMatches,
  fetchMatchById,
  getFinishedMatchesSince,
  formatMatchForUser
};
