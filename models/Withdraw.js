const { getDB } = require('../config/firebase');

function getWithdrawsRef() {
  const dbInstance = getDB();
  if (!dbInstance) return null;
  return dbInstance.ref('withdraws');
}

async function create(withdrawData) {
  const ref = getWithdrawsRef();
  if (!ref) throw new Error('Database not available');

  const pushRef = ref.push();
  await pushRef.set({
    ...withdrawData,
    createdAt: new Date().toISOString(),
    processedAt: null
  });
  const snapshot = await pushRef.once('value');
  return { id: pushRef.key, ...snapshot.val() };
}

async function findById(id) {
  const ref = getWithdrawsRef();
  if (!ref) return null;
  const snapshot = await ref.child(id).once('value');
  if (!snapshot.exists()) return null;
  return { id, ...snapshot.val() };
}

async function findPending() {
  const ref = getWithdrawsRef();
  if (!ref) return [];
  const snapshot = await ref.orderByChild('status').equalTo('PENDING').once('value');
  const withdraws = [];
  snapshot.forEach(child => {
    withdraws.push({ id: child.key, ...child.val() });
  });
  return withdraws;
}

async function findAll() {
  const ref = getWithdrawsRef();
  if (!ref) return [];
  const snapshot = await ref.once('value');
  const withdraws = [];
  snapshot.forEach(child => {
    withdraws.push({ id: child.key, ...child.val() });
  });
  return withdraws.reverse();
}

async function update(id, updates) {
  const ref = getWithdrawsRef();
  if (!ref) throw new Error('Database not available');
  await ref.child(id).update(updates);
  return findById(id);
}

async function countPending() {
  const ref = getWithdrawsRef();
  if (!ref) return 0;
  const snapshot = await ref.orderByChild('status').equalTo('PENDING').once('value');
  return snapshot.numChildren();
}

module.exports = {
  create,
  findById,
  findPending,
  findAll,
  update,
  countPending
};
