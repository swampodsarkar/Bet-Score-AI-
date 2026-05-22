const { getDB } = require('../config/firebase');

function getDepositsRef() {
  const dbInstance = getDB();
  if (!dbInstance) return null;
  return dbInstance.ref('deposits');
}

async function create(depositData) {
  const ref = getDepositsRef();
  if (!ref) throw new Error('Database not available');

  const pushRef = ref.push();
  await pushRef.set({
    ...depositData,
    createdAt: new Date().toISOString(),
    processedAt: null
  });
  const snapshot = await pushRef.once('value');
  return { id: pushRef.key, ...snapshot.val() };
}

async function findById(id) {
  const ref = getDepositsRef();
  if (!ref) return null;
  const snapshot = await ref.child(id).once('value');
  if (!snapshot.exists()) return null;
  return { id, ...snapshot.val() };
}

async function findPending() {
  const ref = getDepositsRef();
  if (!ref) return [];
  const snapshot = await ref.orderByChild('status').equalTo('PENDING').once('value');
  const deposits = [];
  snapshot.forEach(child => {
    deposits.push({ id: child.key, ...child.val() });
  });
  return deposits;
}

async function update(id, updates) {
  const ref = getDepositsRef();
  if (!ref) throw new Error('Database not available');
  await ref.child(id).update(updates);
  return findById(id);
}

async function countPending() {
  const ref = getDepositsRef();
  if (!ref) return 0;
  const snapshot = await ref.orderByChild('status').equalTo('PENDING').once('value');
  return snapshot.numChildren();
}

module.exports = {
  create,
  findById,
  findPending,
  update,
  countPending
};
