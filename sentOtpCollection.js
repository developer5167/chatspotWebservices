// const db = require("./config")  
const db = require("./localDb")  
const OTPS = db.collection("OTPS");
module.exports = OTPS;