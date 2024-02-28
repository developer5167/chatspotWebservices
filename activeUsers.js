// const db = require("./config") 
const db = require("./localDb")  
const User = db.collection("Users");
module.exports = User;