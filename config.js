// Import the functions you need from the SDKs you need
const firebase = require("firebase");
const firebaseConfig = {
  apiKey: "AIzaSyDVzPo6QdvbcthMpeROuehTxUi6sgNqgm0",
  authDomain: "chatspotmain.firebaseapp.com",
  projectId: "chatspotmain",
  storageBucket: "chatspotmain.appspot.com",
  messagingSenderId: "746639355246",
  appId: "1:746639355246:web:6064b5f68d864dce3da57f"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
module.exports =db;