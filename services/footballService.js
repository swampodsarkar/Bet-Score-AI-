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

const LEAGUES = [
  { code: 'PL', name: 'Premier League', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { code: 'CL', name: 'Champions League', emoji: '⭐' },
  { code: 'PD', name: 'La Liga', emoji: '🇪🇸' },
  { code: 'SA', name: 'Serie A', emoji: '🇮🇹' },
  { code: 'BL1', name: 'Bundesliga', emoji: '🇩🇪' },
  { code: 'FL1', name: 'Ligue 1', emoji: '🇫🇷' },
  { code: 'DED', name: 'Eredivisie', emoji: '🇳🇱' },
  { code: 'ELC', name: 'Championship', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { code: 'PPL', name: 'Primeira Liga', emoji: '🇵🇹' },
  { code: 'BSA', name: 'Brasileirão Série A', emoji: '🇧🇷' },
  { code: 'EC', name: 'Euro Championship', emoji: '🌍' },
  { code: 'WC', name: 'FIFA World Cup', emoji: '🏆' }
];

async function fetchUpcomingMatches() {
  const now = Date.now();
  if (cachedMatches.length > 0 && (now - lastFetch) < CACHE_TTL) {
    return cachedMatches;
  }

  try {
    const today = new Date();
    const future = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = future.toISOString().split('T')[0];

    const [scheduled, live] = await Promise.all([
      api.get('/matches', {
        params: {
          competitions: POPULAR_COMPETITIONS,
          dateFrom,
          dateTo,
          status: 'SCHEDULED',
          limit: 50
        }
      }),
      api.get('/matches', {
        params: {
          competitions: POPULAR_COMPETITIONS,
          dateFrom: today.toISOString().split('T')[0],
          dateTo: today.toISOString().split('T')[0],
          status: 'LIVE',
          limit: 20
        }
      })
    ]);

    cachedMatches = [...(scheduled.data.matches || []), ...(live.data.matches || [])];
    cachedMatches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
    lastFetch = now;
    return cachedMatches;
  } catch (error) {
    console.error('Football API error (upcoming):', error.response?.data || error.message);
    return cachedMatches.length > 0 ? cachedMatches : [];
  }
}

function isMatchLive(match) {
  const liveStatuses = ['LIVE', 'IN_PLAY', 'PAUSED'];
  return liveStatuses.includes(match.status);
}

function canBetOnMatch(match) {
  if (!match || isMatchLive(match)) return false;
  const kickoff = new Date(match.utcDate).getTime();
  const now = Date.now();
  const FIFTEEN_MIN = 15 * 60 * 1000;
  return match.status === 'SCHEDULED' || match.status === 'TIMED' && (kickoff - now) > FIFTEEN_MIN;
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

function getLiveScore(match) {
  if (!match || !match.score) return null;
  const home = match.score.fullTime?.home;
  const away = match.score.fullTime?.away;
  if (home !== null && home !== undefined && away !== null && away !== undefined) {
    return `${home} - ${away}`;
  }
  return null;
}

function formatMatchForUser(match) {
  const home = match.homeTeam?.shortName || match.homeTeam?.name || 'Home';
  const away = match.awayTeam?.shortName || match.awayTeam?.name || 'Away';
  const date = new Date(match.utcDate).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const comp = match.competition?.code || '';
  const status = isMatchLive(match) ? '🔴 LIVE' : new Date(match.utcDate).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${home} vs ${away} | ${date} | ${comp} | ID:${match.id}`;
}

async function getMatchesByCompetition(competitionCode) {
  try {
    const today = new Date();
    const future = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = future.toISOString().split('T')[0];

    const [scheduled, live] = await Promise.all([
      api.get('/matches', {
        params: { competitions: competitionCode, dateFrom, dateTo, status: 'SCHEDULED', limit: 20 }
      }),
      api.get('/matches', {
        params: { competitions: competitionCode, dateFrom, dateTo, status: 'LIVE', limit: 10 }
      })
    ]);

    let matches = [...(scheduled.data.matches || []), ...(live.data.matches || [])];
    matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
    return matches;
  } catch (error) {
    console.error(`API error for ${competitionCode}:`, error.response?.data || error.message);
    return [];
  }
}

module.exports = {
  fetchUpcomingMatches,
  fetchMatchById,
  getFinishedMatchesSince,
  getMatchesByCompetition,
  formatMatchForUser,
  isMatchLive,
  canBetOnMatch,
  getLiveScore,
  LEAGUES
};
