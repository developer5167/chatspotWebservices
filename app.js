const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const app = express();
const admin = require("firebase-admin");
const path = require('path');
const fs = require('fs');

// or
const { getMessaging } = require("firebase-admin/messaging"); // if using CommonJS

const serviceAccount = require("./serviceAccountKey.json");
// const serviceAccount = require("/home/bitnami/config/serviceAccountKey.json");
let lastNotifyTime = 0;
const MIN_FAKE = 100;
const MAX_FAKE = 2000;

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
const HuggingFaceBot = require("./huggingface-bot");
const botModule = new HuggingFaceBot(io);
const waitingUsers = new Map();
let virtualUsers = [];

const timers = new Map();
const activeUsers = new Set();
const deviceTokens = new Set(); // Add this at the top, after your other variables

const VIRTUAL_USERS_PATH = path.join(__dirname, "virtual_users.json");

try {
  if (fs.existsSync(VIRTUAL_USERS_PATH)) {
    const data = fs.readFileSync(VIRTUAL_USERS_PATH, "utf8");
    virtualUsers = JSON.parse(data);
    console.log(`Loaded ${virtualUsers.length} virtual users`);
  } else {
    console.log(
      "virtual_users.json not found — virtualUsers is empty for now."
    );
  }
} catch (err) {
  console.error("Error loading virtual_users.json:", err);
  virtualUsers = [];
}




app.get("/", (req, res) => {
  res.send("Welcome");
});
app.post("/register-token", express.json(), (req, res) => {
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

    const wasEmptyBefore = waitingUsers.size === 0;
    waitingUsers.set(id, { id, gender, interestedIn, socketId: socket.id });
    console.log(`[WAITING] User ${id} added to the waiting queue.`);
    socket.emit("waiting", "Waiting for a compatible user...");

    // ✅ ONLY send notification when this is the FIRST AND ONLY user in waiting list
    if (wasEmptyBefore && waitingUsers.size === 1) {
      notifySingleUserWaiting();
    }

    const countdown = setTimeout(() => {
      if (waitingUsers.has(id)) {
        console.log(
          `[TIMEOUT] No real match for ${id}. Trying virtual user...`
        );

        // choose a virtual user profile (implement or reuse your existing pool)
        // Example simple virtual selection:
        const virtualProfile =
          virtualUsers && virtualUsers.length
            ? virtualUsers[Math.floor(Math.random() * virtualUsers.length)]
            : {
                id: `bot_${Math.random().toString(36).slice(2, 8)}`,
                name: "Riya",
                displayName: "Riya",
                persona: "friendly",
                city: "Bengaluru",
              };

        // create server-generated chatId for bot session (must be sent to client)
        const chatId = `chat_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;

        // emit pair event to user with isBot true and chatId
        io.to(socket.id).emit(
          "pair",
          JSON.stringify({
            id: virtualProfile.id || virtualProfile.name,
            gender: virtualProfile.gender || "Any",
            name: virtualProfile.displayName || virtualProfile.name,
            chatId,
            isBot: true,
          })
        );

        // create bot session in separate module and map chat->socket
        botModule.createBotSession(
          chatId,
          {
            id: virtualProfile.id || virtualProfile.name,
            displayName: virtualProfile.displayName || virtualProfile.name,
            persona: virtualProfile.persona,
            city: virtualProfile.city,
            profession: virtualProfile.profession,
            hobby: virtualProfile.hobby,
          },
          socket.id
        );

        // cleanup waiting queue for this user
        waitingUsers.delete(id);
        timers.delete(id);
        activeUsers.delete(id);
        broadcastUserCount();
        return;
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


if (botModule.isBotChat && botModule.isBotChat(chatId)) {
    // still emit the user's message back to the client (so it appears in UI)
    const userSocketId = botModule && botModule.botChatMap ? botModule.botChatMap.get(chatId) : null;
    // simply emit to the room/user so the UI sees the message (existing behavior)
    io.to(chatId).emit("message", data.toString()); // or emit to socket.id if needed

    // let botModule handle reply generation and emission
    botModule.handleUserMessage(chatId, parsedData);
    return;
  }
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
      chatId: chatId,
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
      chatId: chatId,
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
      chatId: chatId,
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
      type: type,
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
      type: type,
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
      callerId: callerId,
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
      endSession
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const chatId = parsedData["chatId"];
    botModule.endSession(chatId)
    io.to(chatId).emit("leftChatRoomMessage", "User left the chat");
  });
  socket.on("getWaitingUsers", (data) => {
    broadcastUserCount();
  });
  socket.on("closedApp", (data) => {
    console.log("closedApp" + data);

    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
      socket.emit("error", "Invalid data format.");
      return;
    }
    const chatId = parsedData["chatId"];
    io.to(chatId).emit("closedApp", "User closed the app");
    broadcastUserCount();
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

// New function specifically for single user waiting scenario
function notifySingleUserWaiting() {
  const now = Date.now();

  // Cooldown check - prevent spam notifications (2 minutes cooldown)
  if (now - lastNotifyTime < 120000) {
    console.log(
      "⏳ Single user notification skipped (2-minute cooldown active)."
    );
    return;
  }

  if (deviceTokens.size === 0) {
    console.log("ℹ️ No device tokens registered for notifications");
    return;
  }

  const tokens = Array.from(deviceTokens);
  const payload = {
    notification: {
      title: "Chat Partner Waiting!",
      body: "Someone is waiting to chat! Open the app now to connect with them.",
    },
  };

  getMessaging()
    .sendEachForMulticast({ tokens, ...payload })
    .then((response) => {
      // Clean up invalid tokens
      response.responses.forEach((res, index) => {
        if (!res.success) {
          const invalidToken = tokens[index];
          deviceTokens.delete(invalidToken);
          console.log("Removed invalid token:", invalidToken);
        }
      });

      lastNotifyTime = now;
      console.log(
        `✅ Single user notification sent to ${response.successCount} users`
      );
      console.log(
        `📢 Message: "Someone is waiting to chat! Open the app now to connect with them."`
      );
    })
    .catch((err) => {
      console.error("❌ Error sending single user notification:", err);
    });
}
function isCompatibleMatch(gender1, interest1, gender2, interest2) {
  if (interest1 === "Auto" || interest2 === "Auto") {
    return true;
  }
  return interest1 === gender2 && interest2 === gender1;
}
setInterval(() => {
  try {
    const fakeWaiting = Math.floor(Math.random() * (MAX_FAKE - MIN_FAKE + 1)) + MIN_FAKE;
    const combinedWaiting = Math.max(waitingUsers.size, fakeWaiting);
    const combinedTotal = activeUsers.size + (combinedWaiting - waitingUsers.size);
    io.emit("updateUserCount", { totalUsers: combinedTotal, waitingUsers: combinedWaiting });
    console.log(`[FAKE-BROADCAST] Active Users: ${combinedTotal}, Waiting Users: ${combinedWaiting}`);
  } catch (err) {
    console.error("Error in fake users broadcast:", err);
  }
}, 10 * 1000); 
const PORT = process.env.PORT || 2000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("server running on " + PORT);
});
