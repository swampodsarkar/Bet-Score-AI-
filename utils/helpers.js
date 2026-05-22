function isAdmin(telegramId) {
  const admins = (process.env.ADMIN_USER_IDS || '').split(',').map(id => parseInt(id.trim()));
  return admins.includes(telegramId);
}

function formatBalance(balance) {
  const num = Number(balance) || 0;
  return `${num.toLocaleString()} coins`;
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function parseBetCommand(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 4) return null;
  const matchId = parseInt(parts[1]);
  const prediction = parts[2].toUpperCase();
  const stake = parseInt(parts[3]);
  if (!matchId || !['HOME', 'DRAW', 'AWAY'].includes(prediction) || !stake || stake < 1) return null;
  return { matchId, prediction, stake };
}

// Get nice display name for user (prefer username)
function getDisplayName(user) {
  if (!user) return 'Player';
  if (user.username) return `@${user.username}`;
  if (user.firstName) return user.firstName;
  return 'Player';
}

module.exports = {
  isAdmin,
  formatBalance,
  escapeMarkdown,
  parseBetCommand,
  getDisplayName
};
