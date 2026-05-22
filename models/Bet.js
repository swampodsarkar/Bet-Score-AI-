const { getDB } = require('../config/firebase');

function getBetsRef() {
  const dbInstance = getDB();
  if (!dbInstance) return null;
  return dbInstance.ref('bets');
}

async function create(betData) {
  const ref = getBetsRef();
  if (!ref) throw new Error('Database not available');

  const pushRef = ref.push();
  await pushRef.set({
    ...betData,
    createdAt: new Date().toISOString(),
    settledAt: null
  });
  const snapshot = await pushRef.once('value');
  return { id: pushRef.key, ...snapshot.val() };
}

async function findById(id) {
  const ref = getBetsRef();
  if (!ref) return null;
  const snapshot = await ref.child(id).once('value');
  if (!snapshot.exists()) return null;
  return { id, ...snapshot.val() };
}

async function findPendingByTelegramId(telegramId) {
  const ref = getBetsRef();
  if (!ref) return [];
  const snapshot = await ref.orderByChild('telegramId').equalTo(Number(telegramId)).once('value');
  const bets = [];
  snapshot.forEach(child => {
    const val = child.val();
    if (val.status === 'PENDING') bets.push({ id: child.key, ...val });
  });
  return bets;
}

async function findPending() {
  const ref = getBetsRef();
  if (!ref) return [];
  const snapshot = await ref.orderByChild('status').equalTo('PENDING').limitToLast(100).once('value');
  const bets = [];
  snapshot.forEach(child => {
    bets.push({ id: child.key, ...child.val() });
  });
  return bets;
}

async function update(id, updates) {
  const ref = getBetsRef();
  if (!ref) throw new Error('Database not available');
  await ref.child(id).update(updates);
  return findById(id);
}

async function count() {
  const ref = getBetsRef();
  if (!ref) return 0;
  const snapshot = await ref.once('value');
  return snapshot.numChildren();
}

module.exports = {
  create,
  findById,
  findPendingByTelegramId,
  findPending,
  update,
  count
};
