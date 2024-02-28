const admin = require('firebase-admin');
// Set the configuration for your app
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "http://localhost:8080"  // Firestore emulator runs on localhost
});
// Get a reference to the Firestore service
const firestore = admin.firestore();
module.exports =firestore;