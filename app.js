const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allowed client origin(s)
    methods: ["GET", "POST"], // Allowed HTTP methods
    allowedHeaders: ["Content-Type"],
    preflightContinue: false, // Allow necessary headers
    credentials: false, // Allow credentials if needed
  },
});
const waitingUsers = new Map();
const timers = new Map();
app.get("/", (req, res) => {
  res.send("Welcome");
});
io.on("connection", (socket) => {
  console.log("A user connected");
  // socket.on('readyToPair', (data) => {
  //   console.log("IDS  " +  waitingUser);
  //   if (waitingUser) {
  //     const parsedData = JSON.parse(data);
  //     interestedIn = parsedData["interestedIn"];
  //     const parsedWaitingUserData = JSON.parse(waitinUserData);
  //     const waitingUserId = parsedWaitingUserData["id"];
  //     const currentUserId = parsedData["id"];
  //     if (waitingUserId != currentUserId) {
  //       if (interestedIn == "Auto") {
  //         // If there is a waiting user, pair the current user with it
  //         socket.emit('pair', waitinUserData);
  //         waitingUser.emit('pair', data);
  //         console.log("pair Completed");
  //         waitingUser = null; // Reset waiting user
  //         waitinUserData = null;
  //       } else if (interestedIn == "Male") {
  //         // If there is a waiting user, pair the current user with it
  //         socket.emit('pair', waitinUserData);
  //         waitingUser.emit('pair', data);
  //         console.log("pair Completed");
  //         waitingUser = null; // Reset waiting user
  //         waitinUserData = null;
  //       } else if (interestedIn == "Female") {
  //         // If there is a waiting user, pair the current user with it
  //         socket.emit('pair', waitinUserData);
  //         waitingUser.emit('pair', data);
  //         console.log("pair Completed");
  //         waitingUser = null; // Reset waiting user
  //         waitinUserData = null;
  //       } else {
  //         socket.emit(
  //           'waiting',
  //           "Waiting for another " + gender + " user to join..."
  //         );
  //       }
  //     } else {
  //       waitingUser.emit(
  //         'waiting',
  //         "Waiting for " + gender + " user to join..."
  //       );
  //     }
  //   } else {
  //     const parsedData = JSON.parse(data);
  //     interestedIn = parsedData["interestedIn"];
  //     console.log("FIRST USER" + data + "     SOCKET ID >>>" + socket.id);
  //     waitingUser = socket;
  //     waitinUserData = data;
  //     socket.emit('waiting', "Waiting for another user to join...");
  //     console.log(">>>>"+waitingUser)
  //   }
  // });

  //   socket.on('readyToPair', (data) => {
  //     console.log("Waiting User: ", waitingUser);

  //     const parsedData = JSON.parse(data);
  //     const currentUserId = parsedData["id"];
  //     const currentGender = parsedData["gender"]; // e.g., "Male", "Female"
  //     const interestedIn = parsedData["interestedIn"]; // e.g., "Male", "Female", "Auto"

  //     if (waitingUser) {
  //         const parsedWaitingUserData = JSON.parse(waitingUserData);
  //         const waitingUserId = parsedWaitingUserData["id"];
  //         const waitingUserGender = parsedWaitingUserData["gender"];
  //         const waitingUserInterest = parsedWaitingUserData["interestedIn"];

  //         // Check if the two users match based on gender preferences
  //         if (waitingUserId !== currentUserId && isCompatibleMatch(currentGender, interestedIn, waitingUserGender, waitingUserInterest)) {
  //             // Pair users
  //             socket.emit('pair', waitingUserData);
  //             waitingUser.emit('pair', data);
  //             console.log("Pairing Completed");

  //             // Reset waiting user
  //             waitingUser = null;
  //             waitingUserData = null;
  //         } else {
  //             socket.emit('waiting', "Waiting for a compatible user...");
  //         }
  //     } else {
  //         // First user joins, store their data
  //         waitingUser = socket;
  //         waitingUserData = data;
  //         console.log("First user joined: " + data + " | Socket ID: " + socket.id);
  //         socket.emit('waiting', "Waiting for another user to join...");
  //     }
  // });

  socket.on("readyToPair", (data) => {
    const parsedData = JSON.parse(data);
    const { id, gender, interestedIn } = parsedData;
    console.log(`[INFO] User ${id} is ready to pair.`);
    // Check if user is already in the queue
    if (waitingUsers.has(id)) {
      socket.emit("waiting", "You are already in the queue...");
      return;
    }

    // Attempt to find a suitable match
    for (const [waitingId, waitingUser] of waitingUsers) {
      if (
        isCompatibleMatch(
          gender,
          interestedIn,
          waitingUser.gender,
          waitingUser.interestedIn
        )
      ) {
        // Pair the users
        io.to(waitingUser.socketId).emit("pair", JSON.stringify({ id, gender }));
        io.to(socket.id).emit("pair", JSON.stringify({ id: waitingUser.id, gender: waitingUser.gender }));
        console.log(`[MATCH] ${id} paired with ${waitingUser.id}`);

        // Remove matched user from the queue
        clearTimeout(timers.get(waitingId));
        timers.delete(waitingId);
        waitingUsers.delete(waitingId);
        waitingUsers.delete(waitingId);
        return;
      }
    }

    // If no match found, add current user to the waiting list
    waitingUsers.set(id, { id, gender, interestedIn, socketId: socket.id });
    console.log(`[WAITING] User ${id} added to the waiting queue.`);
    socket.emit("waiting", "Waiting for a compatible user...");
    const countdown = setTimeout(() => {
      if (waitingUsers.has(id)) {
          waitingUsers.delete(id);
          timers.delete(id);
          socket.emit("timeout", "No user found! change your pref and try rejoin");
          console.log(`[TIMEOUT] User ${id} removed from the queue.`);
      }
  }, 30000); // 30 seconds

  timers.set(id, countdown);
  });

  socket.on("changePreference", (data) => {
    const parsedData = JSON.parse(data);
    const { id, newInterestedIn } = parsedData;

    console.log(`[INFO] User ${id} is updating preference to ${newInterestedIn}.`);

    // Remove user from the waiting queue if they exist
    if (waitingUsers.has(id)) {
        waitingUsers.delete(id);
        console.log(`[UPDATE] User ${id} removed from waiting queue.`);
    }

    // Emit event to notify the user they need to rejoin
    socket.emit("preferenceUpdated", "No user found! change your pref and try rejoin");

    console.log(`[INFO] User ${id} must now rejoin with new preference.`);
});

  socket.on("join", (data) => {
    const parsedData = JSON.parse(data);
    const chatId = parsedData["chatId"];
    socket.join(chatId);
    console.log("ROOM >>> " + chatId);
    socket.broadcast
      .to(chatId)
      .emit("welcomeNote", "A random user joined the chat");
  });
  socket.on("sendMessage", (data) => {
    const parsedData = JSON.parse(data);
    const chatId = parsedData["chatId"];
    io.to(chatId).emit("message", data.toString());
  });
 
  socket.on("typing", (data) => {
    const parsedData = JSON.parse(data);
    const chatId = parsedData["chatId"];

    io.to(chatId).emit("typingMessage", data.toString());
  });
  socket.on("typingOff", (data) => {
    const parsedData = JSON.parse(data);
    const chatId = parsedData["chatId"];
    io.to(chatId).emit("typingMessageOff", data.toString());
  });
  socket.on("leftChatRoom", (data) => {
    const parsedData = JSON.parse(data);
    const chatId = parsedData["chatId"];
    io.to(chatId).emit("leftChatRoomMessage", "User left the chat");
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
    for (const [id, user] of waitingUsers) {
      if (user.socket === socket) {
        waitingUsers.delete(id);
        console.log(`[DISCONNECT] User ${id} removed from queue.`);
        break;
      }
    }
  });
});

function isCompatibleMatch(gender1, interest1, gender2, interest2) {
  if (interest1 === "Auto" || interest2 === "Auto") {
    return true; // Auto means they accept any gender
  }
  return interest1 === gender2 && interest2 === gender1; // Ensure mutual preference
}

const PORT = process.env.PORT || 2000;
server.listen(PORT, () => {
  console.log("server running on" + PORT);
});
