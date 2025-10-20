const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const app = express();
const admin = require("firebase-admin");
// or
const { getMessaging } = require("firebase-admin/messaging"); // if using CommonJS

// const serviceAccount = require("./serviceAccountKey.json");
const serviceAccount = require("/home/bitnami/config/serviceAccountKey.json");
let lastNotifyTime = 0;


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    preflightContinue: false,
    credentials: false,
  },
});
const waitingUsers = new Map();
const timers = new Map();
const activeUsers = new Set();
const deviceTokens = new Set(); // Add this at the top, after your other variables


app.get("/", (req, res) => {
  res.send("Welcome");
});
app.post('/register-token', express.json(), (req, res) => {
  const { token } = req.body;
  if (token) {
  deviceTokens.add(token);
  console.log("Registered device token:", token);
}
  res.status(200).send({ success: true });
});
io.on("connection", (socket) => {
  io.emit("");
  console.log("A user connected");

  socket.on("readyToPair", (data) => {
    // notifyPreviousUsers()
    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const { id, gender, interestedIn } = parsedData;
    console.log(`[INFO] User ${id} is ready to pair.`);
    activeUsers.add(id);

    if (waitingUsers.has(id)) {
      socket.emit("waiting", "You are already in the queue...");
      return;
    }

    for (const [waitingId, waitingUser] of waitingUsers) {
      if (
        isCompatibleMatch(
          gender,
          interestedIn,
          waitingUser.gender,
          waitingUser.interestedIn
        )
      ) {
        io.to(waitingUser.socketId).emit(
          "pair",
          JSON.stringify({ id, gender })
        );
        io.to(socket.id).emit(
          "pair",
          JSON.stringify({ id: waitingUser.id, gender: waitingUser.gender })
        );
        console.log(`[MATCH] ${id} paired with ${waitingUser.id}`);

        if (timers.has(waitingId)) {
          clearTimeout(timers.get(waitingId));
          timers.delete(waitingId);
        }
        waitingUsers.delete(waitingId);
        activeUsers.delete(waitingUser.id);
        activeUsers.delete(id);
        broadcastUserCount();
        
        return;
      }
    }

    waitingUsers.set(id, { id, gender, interestedIn, socketId: socket.id });
    console.log(`[WAITING] User ${id} added to the waiting queue.`);
    socket.emit("waiting", "Waiting for a compatible user...");
if (waitingUsers.size === 1) {
  maybeNotifyUsers();
}
    const countdown = setTimeout(() => {
      if (waitingUsers.has(id)) {
        waitingUsers.delete(id);
        timers.delete(id);
        activeUsers.delete(id);
        broadcastUserCount();
        socket.emit(
          "timeout",
          "No user found! change your pref and try rejoin"
        );
        console.log(`[TIMEOUT] User ${id} removed from the queue.`);
      }
    }, 30000);

    timers.set(id, countdown);
    broadcastUserCount();
  });

  socket.on("changePreference", (data) => {
    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const { id, newInterestedIn } = parsedData;

    console.log(
      `[INFO] User ${id} is updating preference to ${newInterestedIn}.`
    );

    if (waitingUsers.has(id)) {
      waitingUsers.delete(id);
      if (timers.has(id)) {
        clearTimeout(timers.get(id));
        timers.delete(id);
      }
      activeUsers.delete(id);
      console.log(`[UPDATE] User ${id} removed from waiting queue.`);
      broadcastUserCount();
    }

    socket.emit(
      "preferenceUpdated",
      "No user found! change your pref and try rejoin"
    );

    console.log(`[INFO] User ${id} must now rejoin with new preference.`);
  });

  socket.on("join", (data) => {
    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const chatId = parsedData["chatId"];
    socket.join(chatId);
    console.log("ROOM >>> " + chatId);
    socket.broadcast
      .to(chatId)
      .emit("welcomeNote", "A random user joined the chat");
  });

  socket.on("sendMessage", (data) => {
    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const chatId = parsedData["chatId"];
    io.to(chatId).emit("message", data.toString());
  });

 socket.on("offer", (data) => {
  let parsedData;
  try {
    parsedData = typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    socket.emit("error", "Invalid data format.");
    return;
  }
  const chatId = parsedData["chatId"];
  const senderId = parsedData["senderId"];
  
  console.log(`📞 Offer from ${senderId} in chat ${chatId}`);
  
  // Send to other users in the room except sender
  socket.to(chatId).emit("offer", {
    sdp: parsedData.sdp,
    type: parsedData.type,
    senderId: senderId,
    chatId: chatId
  });
});

socket.on("answer", (data) => {
  let parsedData;
  try {
    parsedData = typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    socket.emit("error", "Invalid data format.");
    return;
  }
  const chatId = parsedData["chatId"];
  const senderId = parsedData["senderId"];
  
  console.log(`✅ Answer from ${senderId} in chat ${chatId}`);
  
  socket.to(chatId).emit("answer", {
    sdp: parsedData.sdp,
    type: parsedData.type,
    senderId: senderId,
    chatId: chatId
  });
});

socket.on("candidate", (data) => {
  let parsedData;
  try {
    parsedData = typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    socket.emit("error", "Invalid data format.");
    return;
  }
  const chatId = parsedData["chatId"];
  const senderId = parsedData["senderId"];
  
  socket.to(chatId).emit("candidate", {
    candidate: parsedData.candidate,
    sdpMid: parsedData.sdpMid,
    sdpMLineIndex: parsedData.sdpMLineIndex,
    senderId: senderId,
    chatId: chatId
  });
});

 socket.on("call_user", (data) => {
  let parsedData;
  try {
    parsedData = typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    socket.emit("error", "Invalid data format.");
    return;
  }
  const chatId = parsedData["chatId"];
  const callerId = parsedData["callerId"];
  const type = parsedData["type"];
  
  console.log(`📞 ${type} call from ${callerId} in chat ${chatId}`);
  
  // Notify the other user in the chat room
  socket.to(chatId).emit("incoming_call", {
    callerId: callerId,
    chatId: chatId,
    type: type
  });
});

  socket.on("accept_call", (data) => {
  let parsedData;
  try {
    parsedData = typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    socket.emit("error", "Invalid data format.");
    return;
  }
  const chatId = parsedData["chatId"];
  const callerId = parsedData["callerId"];
  const type = parsedData["type"];
  
  console.log(`✅ Call accepted in chat ${chatId}`);
  
  socket.to(chatId).emit("call_accepted", {
    chatId: chatId,
    type: type
  });
});

  socket.on("reject_call", (data) => {
  let parsedData;
  try {
    parsedData = typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    socket.emit("error", "Invalid data format.");
    return;
  }
  const chatId = parsedData["chatId"];
  const callerId = parsedData["callerId"];
  
  console.log(`❌ Call rejected in chat ${chatId}`);
  
  socket.to(chatId).emit("call_rejected", {
    chatId: chatId,
    callerId: callerId
  });
});


  socket.on("hang_up", (data) => {
  let parsedData;
  try {
    parsedData = typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    socket.emit("error", "Invalid data format.");
    return;
  }
  const chatId = parsedData["chatId"];
  
  console.log(`📞 Call ended in chat ${chatId}`);
  
  socket.to(chatId).emit("call_ended");
});

  socket.on("typing", (data) => {
    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const chatId = parsedData["chatId"];
    io.to(chatId).emit("typingMessage", data.toString());
  });

  socket.on("typingOff", (data) => {
    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const chatId = parsedData["chatId"];
    io.to(chatId).emit("typingMessageOff", data.toString());
  });

  socket.on("leftChatRoom", (data) => {
    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const chatId = parsedData["chatId"];
    io.to(chatId).emit("leftChatRoomMessage", "User left the chat");
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
    let removedId = null;
    for (const [id, user] of waitingUsers) {
      if (user.socketId === socket.id) {
        waitingUsers.delete(id);
        if (timers.has(id)) {
          clearTimeout(timers.get(id));
          timers.delete(id);
        }
        activeUsers.delete(id);
        removedId = id;
        console.log(`[DISCONNECT] User ${id} removed from queue.`);
        broadcastUserCount();
        break;
      }
    }
    if (removedId) {
      activeUsers.delete(removedId);
    }
    if (activeUsers.size === 0) {
      notifyPreviousUsers("A new user joined! Open the app to chat.");
    }
  });
});

function broadcastUserCount() {
  const totalUsers = activeUsers.size;
  const waitingUsersCount = waitingUsers.size;
  console.log(
    `[UPDATE] Active Users: ${totalUsers}, Waiting Users: ${waitingUsersCount}`
  );
  io.emit("updateUserCount", { totalUsers, waitingUsers: waitingUsersCount });
}

function notifyPreviousUsers(message) {
  if (deviceTokens.size === 0) return;

  const tokens = Array.from(deviceTokens);
  const payload = {
    notification: {
      title: "Pair",
      body: message,
    },
  };

  getMessaging()
    .sendEachForMulticast({ tokens, ...payload })
    .then((response) => {
      response.responses.forEach((res, index) => {
        if (!res.success) {
          const invalidToken = tokens[index];
          deviceTokens.delete(invalidToken);
          console.log("Removed invalid token:", invalidToken);
        }
      });
      console.log(`✅ Sent to ${response.successCount} users`);
    })
    .catch((err) => {
      console.error("❌ Error sending notifications:", err);
    });
}

function isCompatibleMatch(gender1, interest1, gender2, interest2) {
  if (interest1 === "Auto" || interest2 === "Auto") {
    return true;
  }
  return interest1 === gender2 && interest2 === gender1;
}
function maybeNotifyUsers() {
  const now = Date.now();

  // Notify only if it's been 30 seconds since last notification
  if (now - lastNotifyTime > 30000) {
    notifyPreviousUsers("Someone is waiting to chat! Join now and start a conversation.");
    lastNotifyTime = now;
    console.log("🔔 Notification sent to previous users.");
  } else {
    console.log("⏳ Notification skipped (cooldown active).");
  }
}
const PORT = process.env.PORT || 2000;
server.listen(PORT,"0.0.0.0", () => {
  console.log("server running on " + PORT);
});