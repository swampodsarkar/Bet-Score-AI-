const { getDB } = require('../config/firebase');

function getUsersRef() {
  const dbInstance = getDB();
  if (!dbInstance) {
    console.warn('Firebase DB not initialized');
    return null;
  }
  return dbInstance.ref('users');
}

async function findOne(telegramId) {
  const ref = getUsersRef();
  if (!ref) return null;

  const snapshot = await ref.child(telegramId).once('value');
  if (!snapshot.exists()) return null;
  const data = snapshot.val();
  return { telegramId: Number(telegramId), ...data };
}

async function create(userData) {
  const ref = getUsersRef();
  if (!ref) throw new Error('Database not available');

  const { telegramId, ...rest } = userData;
  await ref.child(telegramId).set({
    ...rest,
    createdAt: new Date().toISOString()
  });
  return findOne(telegramId);
}

async function update(telegramId, updates) {
  const ref = getUsersRef();
  if (!ref) throw new Error('Database not available');

  await ref.child(telegramId).update(updates);
  return findOne(telegramId);
}

async function findTop(limit = 10) {
  const ref = getUsersRef();
  if (!ref) return [];

  const snapshot = await ref.orderByChild('balance').limitToLast(limit).once('value');
  const users = [];
  snapshot.forEach(child => {
    users.push({ telegramId: Number(child.key), ...child.val() });
  });
  return users.reverse();
}

async function count() {
  const ref = getUsersRef();
  if (!ref) return 0;

  const snapshot = await ref.once('value');
  return snapshot.numChildren();
}

async function aggregateTotalBalance() {
  const ref = getUsersRef();
  if (!ref) return 0;

  const snapshot = await ref.once('value');
  let total = 0;
  snapshot.forEach(child => {
    total += child.val().balance || 0;
  });
  return total;
}

module.exports = {
  findOne,
  create,
  update,
  findTop,
  count,
  aggregateTotalBalance
};
