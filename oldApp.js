const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const app = express();
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
// or
const { getMessaging } = require("firebase-admin/messaging"); // if using CommonJS

const serviceAccount = require("./serviceAccountKey.json");
// const serviceAccount = require("/home/bitnami/config/serviceAccountKey.json");
const waitingUsers = new Map();
const timers = new Map();
const activeUsers = new Set();
const deviceTokens = new Set(); // Add this at the top, after your other variables
const userLastBotMap = new Map();
const botSessions = new Map();
const chatAnalytics = new Map();
const botChatMap = new Map();
let virtualUsers = [];
const MIN_GHOSTS_IN_QUEUE = 2000;

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

function makeVirtualEntry(profile) {
  return {
    id: `virtual_${profile.id || Math.random().toString(36).slice(2, 9)}`,
    displayName: profile.name || "Mysti",
    gender: profile.gender || "Any",
    interestedIn: "Auto",
    socketId: null, // bots have no socket
    isBot: true,
    persona: profile.persona || "friendly",
    state: profile.state || "Unknown",
    city: profile.city || "",
    language: profile.language || "English",
    createdAt: Date.now(),
    // runtime-only properties:
    __cooldownUntil: 0,
  };
}

// add virtual users until waitingUsers.size >= minCount
function addVirtualUsersIfEmpty(minCount = MIN_GHOSTS_IN_QUEUE) {
  try {
    // only add if waitingUsers < minCount
    if (waitingUsers.size >= minCount) return;

    // shuffle virtualUsers for randomness (simple shuffle)
    const pool = virtualUsers.slice().sort(() => Math.random() - 0.5);

    for (let i = 0; i < pool.length && waitingUsers.size < minCount; i++) {
      const profile = pool[i];
      // skip profiles which are under cooldown (we track cooldown inside runtime)
      const cooldownUntil = profile.__cooldownUntil || 0;
      if (Date.now() < cooldownUntil) continue;

      const v = makeVirtualEntry(profile);
      // set a reasonable cooldown on this profile to avoid immediate reuse
      profile.__cooldownUntil = Date.now() + 2 * 60 * 1000; // 2 minutes

      // store in waitingUsers (so all existing logic that reads waitingUsers works)
      waitingUsers.set(v.id, v);
      // console.log(
      //   `[VIRTUAL-ADD] ${v.id} (${v.displayName}) added to waiting queue`
      // );
    }

    broadcastUserCount();
  } catch (err) {
    console.error("Error in addVirtualUsersIfEmpty:", err);
  }
}

// pick a virtual user entry from waitingUsers (returns the entry and removes it from waiting queue)
function pickVirtualFromWaiting() {
  const now = Date.now();
  for (const [id, user] of waitingUsers) {
    // ensure it's a bot and not under cooldown
    if (user.isBot && (!user.__cooldownUntil || now > user.__cooldownUntil)) {
      waitingUsers.delete(id);
      // set cooldown to avoid immediate reuse across server restarts too
      user.__cooldownUntil = Date.now() + 3 * 60 * 1000; // 3 minutes
      return user;
    }
  }
  return null;
}

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
      if (waitingUser.isBot) continue;
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

        // Try to get one virtual user from waiting queue
        let virtualUser = pickVirtualFromWaiting();

        if (virtualUser) {
          // avoid giving the same bot twice in a row to the same user
          const lastBotId = userLastBotMap.get(id);
          if (lastBotId === virtualUser.id) {
            // try one more time for a different bot
            console.log(
              `[BOT-TRY] picked same bot as last time for ${id}, trying another...`
            );
            // put the bot back into pool by just skipping this one (it already had cooldown)
            virtualUser = pickVirtualFromWaiting();
          }

          if (virtualUser) {
            // record last bot used for this user
            userLastBotMap.set(id, virtualUser.id);

            // remove this real user from waiting list
            waitingUsers.delete(id);
            timers.delete(id);
            activeUsers.delete(id);
            
            const chatId = `chat_${Date.now()}_${Math.random()
              .toString(36)
              .slice(2, 6)}`;

            // Send 'pair' event to real user only (bot has no socket)
            io.to(socket.id).emit(
              "pair",
              JSON.stringify({
                id: virtualUser.id,
                gender: virtualUser.gender,
                name: virtualUser.displayName,
                chatId,
                isBot: true,
              })
            );
          botChatMap.set(chatId, socket.id);

            console.log(
              `[BOT-PAIR] ${id} paired with virtual ${virtualUser.displayName}`
            );

            // Start the bot conversation
            startBotConversation(chatId, virtualUser, id);

            broadcastUserCount();
            return; // stop here
          }
        }

        // fallback (no virtuals found)
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
  // ---------------- BOT CONVERSATION LOGIC ---------------- //

  // chatId -> { botName, startTime, messageCount, persona }

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
    // sendPushNotificationForMessage(data.toString())
    const userSocketId = botChatMap.get(chatId);
    if (userSocketId) {
      io.to(userSocketId).emit("message", data.toString());
    } else {
      io.to(chatId).emit("message", data.toString()); // fallback for real-user chats
    }
    // 👇 If talking with a bot, auto-reply
    try {
      const parsedMsg = typeof data === "string" ? JSON.parse(data) : data;

      // Skip if this is already a bot message
      if (!parsedMsg.isBot) {
        const session = botSessions.get(chatId);
        if (session) {
          // get bot name from analytics if available
          const botName = chatAnalytics.get(chatId)?.botName || "Mysti";
          const botProfileObj = {
            id: session.botId,
            displayName: botName,
            city: chatAnalytics.get(chatId)?.city || "",
            profession: chatAnalytics.get(chatId)?.profession || "",
            hobby: chatAnalytics.get(chatId)?.hobby || "",
          };
          const userText = parsedMsg.text || "";
          const persona = session.persona || "friendly";
          const reply = generateBotReply(userText, persona, botProfileObj);

          // Simulate human delay before responding
          setTimeout(() => {
            sendBotMessage(chatId, botProfileObj, reply);
            scheduleFollowUp(chatId, botProfileObj);
          }, randomMs(2000, 5000)); // 2–5s delay
        }
      }
    } catch (err) {
      console.error("BOT reply error:", err);
    }
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
    const userSocketId = botChatMap.get(chatId);
    if (userSocketId) {
      io.to(userSocketId).emit("typingMessage", {"status":true});
    } else {
      io.to(chatId).emit("typingMessage", data.toString());
    }
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
    const userSocketId = botChatMap.get(chatId);
    if (userSocketId) {
      io.to(userSocketId).emit("typingMessageOff", {"status":false});
    } else {
      io.to(chatId).emit("typingMessageOff", data.toString());
    }
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

function sendPushNotificationForMessage(message) {
  const now = Date.now();

  // Cooldown check - prevent spam notifications (2 minutes cooldown)
  // if (now - lastNotifyTime < 120000) {
  //   console.log(
  //     "⏳ Single user notification skipped (2-minute cooldown active)."
  //   );
  //   return;
  // }

  if (deviceTokens.size === 0) {
    console.log("ℹ️ No device tokens registered for notifications");
    return;
  }

  const tokens = Array.from(deviceTokens);
  const payload = {
    notification: {
      title: "New Message Received!",
      body: message,
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

function startBotConversation(chatId, botProfile, realUserId) {
  const personaKey = botProfile.persona || "friendly";
  console.log(
    `[BOT-START] ${botProfile.displayName} (${personaKey}) chatting with ${realUserId}`
  );

  // store analytics info
  chatAnalytics.set(chatId, {
    botName: botProfile.displayName,
    startTime: Date.now(),
    messageCount: 0,
    persona: personaKey,
    city: botProfile.city || "",
    profession: botProfile.profession || "",
    hobby: botProfile.hobby || "",
  });

  botSessions.set(chatId, {
    botId: botProfile.id,
    messageCount: 0,
    persona: personaKey,
  });

  setTimeout(() => {
    const greetings = ["hi", "hey", "hello", "hi there"];
    const greet = greetings[Math.floor(Math.random() * greetings.length)];
    sendBotMessage(chatId, botProfile, greet);
  }, randomMs(1000, 2500));
}

// helper: send message + typing effect
// helper: send message + typing effect
function sendBotMessage(chatId, botProfile, message) {
  console.log(chatId,botProfile,message);
  
  const session = botSessions.get(chatId);
  if (!session) return;

  session.messageCount++;
  const stats = chatAnalytics.get(chatId);
  if (stats) stats.messageCount = (stats.messageCount || 0) + 1;

  // Get current user socket for this bot chat (may be undefined for real-room chats)
  const userSocketId = botChatMap.get(chatId);

  // emit typing indicator first
  if (userSocketId) {
    io.to(userSocketId).emit(
      "typingMessage",
      {"status":true}
    );
  } else {
    io.to(chatId).emit(
      "typingMessage",
      {"status":true}
    );
  }

  let typingDelay = Math.min(3000, message.length * 60 + randomMs(300, 800));
  if (Math.random() < 0.2) typingDelay += randomMs(1000, 2000); // 20% chance extra "thinking"

  setTimeout(() => {
    // re-read socket mapping in case it changed
    const currentUserSocketId = botChatMap.get(chatId);

    // typing off
    if (currentUserSocketId) {
      io.to(currentUserSocketId).emit(
"typingMessageOff",
        {"status":true}
      );
    } else {
      io.to(chatId).emit(
        "typingMessageOff",
       {"status":false}
      );
    }

    // payload and message emit (to user socket for bot chats or to room for real chats)
    const payload = {
      chatId,
      senderId: botProfile.id,
      name: botProfile.displayName,
      isBot: true,
      message,
    };

    if (currentUserSocketId) {
      io.to(currentUserSocketId).emit("message", JSON.stringify(payload));
    } else {
      io.to(chatId).emit("message", JSON.stringify(payload));
    }

    console.log(`[BOT] ${botProfile.displayName}: ${message}`);

    // clear any followUpTimer because bot just spoke
    if (session.followUpTimer) {
      clearTimeout(session.followUpTimer);
      delete session.followUpTimer;
    }

    // end conversation politely after 20 messages
    if (session.messageCount >= 20) {
      const goodbyes = [
        "It was really nice chatting with you 😊",
        "Haha this was fun 😄 see you around!",
        "Nice talking to you! 👋",
        "That was a cool chat 😎 catch you later!",
        "Had a good time talking 😄 take care!",
        "Alright, I’ll go now 😊 was nice meeting you!",
      ];
      const bye = goodbyes[Math.floor(Math.random() * goodbyes.length)];
      setTimeout(() => {
        // send final bye (same code path)
        sendBotMessage(chatId, botProfile, bye);
        // ensure end happens after bye is delivered
        setTimeout(() => endBotChat(chatId), 500);
      }, randomMs(2000, 4000));
    }
  }, typingDelay);
}

function endBotChat(chatId) {
  if (botSessions.has(chatId)) {
    botSessions.delete(chatId);
  }

  // If this was a bot chat, notify the specific user socket; otherwise notify the room
  const userSocketId = botChatMap.get(chatId);
  if (userSocketId) {
    io.to(userSocketId).emit(
      "system",
      JSON.stringify({ chatId, text: "Chat ended ✨" })
    );
  } else {
    io.to(chatId).emit(
      "system",
      JSON.stringify({ chatId, text: "Chat ended ✨" })
    );
  }

  const stats = chatAnalytics.get(chatId);
  if (stats) {
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(
      `📊 Chat with ${stats.botName} ended — ${stats.messageCount} messages in ${duration}s (${stats.persona})`
    );
    chatAnalytics.delete(chatId);
  }
  // cleanup mapping
  botChatMap.delete(chatId);
}


function randomMs(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

addVirtualUsersIfEmpty( MIN_GHOSTS_IN_QUEUE);

setInterval(() => {
    fluctuateVirtualUsers(100, 2000);
}, 10 * 1000);
// ---------------- BOT PERSONALITY PROFILES ---------------- //
const botPersonalities = {
  friendly: {
    emojis: ["😊", "😄", "🙂", "😁"],
    tone: ["haha", "lol", "that's nice", "sounds fun"],
  },
  chill: {
    emojis: ["😌", "✌️", "😅"],
    tone: ["yeah", "cool", "makes sense", "true that"],
  },
  curious: {
    emojis: ["🤔", "😄", "🙂"],
    tone: ["really?", "tell me more", "interesting!", "what about you?"],
  },
  witty: {
    emojis: ["😉", "😏", "😂"],
    tone: ["haha good one", "you’re funny!", "lol right!"],
  },
};

function generateBotReply(text, personaKey = "friendly", botProfile = {}) {
  const lower = (text || "").toLowerCase();
  const persona = botPersonalities[personaKey] || botPersonalities["friendly"];

  // --- safety filters ---
  const genderWords = ["boy", "girl", "b or g", "b/g", "bg", "gender"];
  const personalWords = [
    "insta",
    "instagram",
    "snap",
    "snapchat",
    "whatsapp",
    "number",
    "contact",
    "pic",
    "photo",
    "selfie",
  ];
  const langWords = [
    "hindi",
    "tamil",
    "telugu",
    "malayalam",
    "kannada",
    "language",
  ];
  const nameWords = ["name", "who are you", "ur name", "your name"];
  const fromWords = ["where", "city", "from", "place"];
  const jobWords = ["work", "job", "do for living", "office"];
  const hobbyWords = ["hobby", "fun", "free time", "weekend"];

  if (genderWords.some((w) => lower.includes(w)))
    return "Haha maybe guess 😄 but I don’t really talk about that here.";
  if (personalWords.some((w) => lower.includes(w)))
    return "I don't share personal details online 😊 hope you understand!";
  if (langWords.some((w) => lower.includes(w)))
    return "Haha I mostly chat in English 😅 makes it easier for everyone!";
  if (nameWords.some((w) => lower.includes(w)))
    return `I'm ${botProfile.displayName || "someone"} 😄 what about you?`;
  if (fromWords.some((w) => lower.includes(w)))
    return `I'm from ${botProfile.city || "India"} 😄 how about you?`;
  if (jobWords.some((w) => lower.includes(w)))
    return `I work as a ${
      botProfile.profession || "freelancer"
    } 🙂 what about you?`;
  if (hobbyWords.some((w) => lower.includes(w)))
    return `I usually spend time ${
      botProfile.hobby || "listening to music"
    } 😄 you?`;

  // --- small talk templates ---
  const replies = [
    "Oh really? That sounds nice",
    "Haha same here!",
    "Interesting! Tell me more.",
    "That’s cool, I like that.",
    "Hmm nice 😄 what do you usually do on weekends?",
    "Haha yeah totally!",
    "Cool 😄 what are you up to now?",
    "That’s something I’d like to try someday!",
  ];

  let msg = replies[Math.floor(Math.random() * replies.length)];

  // vary expressiveness
  const expressiveness = Math.random();
  if (expressiveness < 0.4)
    msg = `${
      persona.tone[Math.floor(Math.random() * persona.tone.length)]
    }, ${msg}`;
  if (expressiveness < 0.7)
    msg +=
      " " + persona.emojis[Math.floor(Math.random() * persona.emojis.length)];

  return msg.trim();
}
const followUpQuestions = [
  "You there? 😄",
  "Haha went silent 😅 what you doing?",
  "Still here?",
  "Tell me about yourself 😄",
  "So, what do you do?",
  "What kind of music do you like?",
  "Haha don’t go quiet on me 😅",
];

function scheduleFollowUp(chatId, botProfile) {
  const session = botSessions.get(chatId);
  if (!session) return;

  if (session.followUpTimer) clearTimeout(session.followUpTimer);

  session.followUpTimer = setTimeout(() => {
    const msg =
      followUpQuestions[Math.floor(Math.random() * followUpQuestions.length)];
    sendBotMessage(chatId, botProfile, msg);
  }, randomMs(12000, 18000)); // 12–18 sec of user silence
}
// ----------------- FLUCTUATE VIRTUAL USERS (100 - 2000) ----------------- //

/**
 * Keep bot waiting count oscillating between minRange and maxRange.
 * - Adds or removes bots so count approaches a random target in [minRange, maxRange].
 * - Minimal changes to existing data structures.
 */
function fluctuateVirtualUsers(minRange = 100, maxRange = 2000) {
  try {
    // Current bot-only waiting count
    const botEntries = Array.from(waitingUsers.entries()).filter(([_, u]) => u.isBot);
    let currentBotCount = botEntries.length;

    // Pick a new random target between minRange and maxRange
    const target = Math.max(minRange, Math.min(maxRange, Math.floor(Math.random() * (maxRange - minRange + 1)) + minRange));

    // If already equal, small random jitter possibility: +/- up to 5
    if (currentBotCount === target) {
      if (Math.random() < 0.4) { // 40% chance to jitter a little
        const jitter = Math.floor(Math.random() * 11) - 5; // -5..+5
        if (jitter > 0) {
          addBots(Math.min(jitter, virtualUsers.length - currentBotCount));
        } else if (jitter < 0) {
          removeBots(Math.min(Math.abs(jitter), currentBotCount));
        }
      }
      broadcastUserCount();
      return;
    }

    if (currentBotCount < target) {
      // need to add bots
      const toAdd = Math.min(target - currentBotCount, virtualUsers.length - currentBotCount);
      addBots(toAdd);
    } else if (currentBotCount > target) {
      // need to remove bots
      const toRemove = Math.min(currentBotCount - target, currentBotCount);
      removeBots(toRemove);
    }

    broadcastUserCount();
  } catch (err) {
    console.error("Error in fluctuateVirtualUsers:", err);
  }
}

// helper to add N bots (reuses addVirtualUsersIfEmpty internals but explicitly adds count)
function addBots(n) {
  if (!virtualUsers || virtualUsers.length === 0 || n <= 0) return;
  // shuffle virtualUsers pool for randomness
  const pool = virtualUsers.slice().sort(() => Math.random() - 0.5);

  let added = 0;
  for (const profile of pool) {
    if (added >= n) break;
    // skip if this profile is in cooldown (runtime flag on profile)
    if (profile.__cooldownUntil && Date.now() < profile.__cooldownUntil) continue;

    // create entry and add
    const v = makeVirtualEntry(profile);
    waitingUsers.set(v.id, v);

    // mark profile cooldown to avoid immediate reuse
    profile.__cooldownUntil = Date.now() + 2 * 60 * 1000; // 2 minutes
    console.log(`[VIRTUAL-ADD] ${v.id} (${v.displayName}) added to waiting queue`);
    added++;
  }
}

// helper to remove N bots at random from waitingUsers
function removeBots(n) {
  const bots = Array.from(waitingUsers.entries()).filter(([id, u]) => u.isBot);
  if (bots.length === 0 || n <= 0) return;

  // shuffle and remove `n` of them
  for (let i = 0; i < n && bots.length > 0; i++) {
    const idx = Math.floor(Math.random() * bots.length);
    const [removeId, removeUser] = bots.splice(idx, 1)[0];
    waitingUsers.delete(removeId);
    // console.log(`[VIRTUAL-REMOVE] ${removeId} (${removeUser.displayName}) removed from waiting queue`);
  }
}


const PORT = process.env.PORT || 2000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("server running on " + PORT);
});
