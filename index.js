const http = require('http');
const express = require("express");
const socket = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socket(server);
let myHashMap = new Map();
myHashMap.clear()

let keys = []
let waitingUser = null;
let interestedIn = "auto";
let waitinUserData = null;

app.get("/", (req, res) => {
  res.send("Welcome")
})
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on("readyToPair", (data) => {

    if (waitingUser) {
      const parsedData = JSON.parse(data)
      const gender = parsedData["interestedIn"];
      const parsedWaitingUserData = JSON.parse(waitinUserData)
      const waitingUserId = parsedWaitingUserData["id"];
      const currentUserId = parsedData["id"];
      if (waitingUserId != currentUserId) {
        if (interestedIn == "auto") {
          // If there is a waiting user, pair the current user with it
          console.log("SECOND USER" + data + "SOCKET ID >>>" + socket.id + " >>>   " + waitingUser.id + "    >>>>" + waitinUserData)
          socket.emit('pair', waitinUserData);
          waitingUser.emit('pair', data);
          console.log('pair Completed');
          waitingUser = null; // Reset waiting user
          waitinUserData = null;
          interestedIn = "auto"
        } else if (interestedIn == gender) {
          // If there is a waiting user, pair the current user with it
          console.log("SECOND USER" + data + "SOCKET ID >>>" + socket.id + " >>>   " + waitingUser.id + "    >>>>" + waitinUserData)
          socket.emit('pair', waitinUserData);
          waitingUser.emit('pair', data);
          console.log('pair Completed');
          waitingUser = null; // Reset waiting user
          waitinUserData = null;
          interestedIn = "auto"
        } else {
          socket.emit('waiting', 'Waiting for another ' + gender + ' user to join...');
        }
      } else {
        waitingUser.emit('waiting', 'Waiting for ' + gender + ' user to join...');
      }
    } else {
      const parsedData = JSON.parse(data)
      interestedIn = parsedData["interestedIn"];
      console.log("FIRST USER" + data + "     SOCKET ID >>>" + socket.id)
      waitingUser = socket;
      waitinUserData = data
      socket.emit('waiting', 'Waiting for another user to join...');
    }
  })
  socket.on("join", (data) => {
    const parsedData = JSON.parse(data)
    const chatId = parsedData["chatId"];
    socket.join(chatId)
    console.log("ROOM >>> " + chatId)
    socket.broadcast.to(chatId).emit("welcomeNote", "A random user joined the chat")
  })
  socket.on("sendMessage", (data) => {
    const parsedData = JSON.parse(data)
    const chatId = parsedData["chatId"];
    console.log("RECEIEVED MESSAGE >> " + parsedData["message"] + "  " + parsedData["chatId"])
    io.to(chatId).emit('message', data);
  })
  socket.on("leftChatRoom", ({ chatId }) => {
    console.log("RECEIEVED MESSAGE >> " + chatId)
    io.to(chatId).emit('leftChatRoomMessage', "User left the chat");
  })

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});
const PORT = process.env.PORT || 2000;

server.listen(PORT, "0.0.0.0", () => {
  console.log('server running on' + PORT)
  waitingUser = null;
  interestedIn = "auto";
  waitinUserData = null;
})

