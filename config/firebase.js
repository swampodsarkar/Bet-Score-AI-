const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let db = null;

function initFirebase() {
  if (db) return db;

  try {
    let serviceAccount;

    // Option 1: Service account JSON file (recommended for local)
    const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    if (fs.existsSync(keyPath)) {
      try {
        const fileContent = fs.readFileSync(keyPath, 'utf8');
        serviceAccount = JSON.parse(fileContent);
      } catch (readErr) {
        console.error('Failed to read serviceAccountKey.json:', readErr.message);
        throw new Error('Invalid or corrupted serviceAccountKey.json file. Please re-download it from Firebase Console.');
      }
    } 
    // Option 2: Base64 encoded in env (for Render/Railway etc)
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decoded);
    } 
    // Option 3: Individual env variables (no JSON file needed)
    else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
      };
    } 
    else {
      console.warn('⚠️  Firebase credentials not found. Server will start but database features will not work until you add credentials.');
      console.warn('   Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env');
      return null;   // allow server to start
    }

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://gen-z-airdrop-default-rtdb.asia-southeast1.firebasedatabase.app"
      });

      db = admin.database();
      console.log('✅ Firebase Realtime Database initialized');
    } else {
      db = null;
    }
    return db;
  } catch (error) {
    console.error('Firebase init error:', error.message);
    process.exit(1);
  }
}

function getDB() {
  if (!db) initFirebase();
  return db;
}

module.exports = { initFirebase, getDB, admin };
