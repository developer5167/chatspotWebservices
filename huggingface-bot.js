// huggingface-bot.js
const fetch = require("node-fetch");
require("dotenv").config();

class HuggingFaceBot {
  constructor(io) {
    this.io = io;
    this.apiKey = process.env.HUGGINGFACE_API_KEY;

    if (!this.apiKey) {
      console.error("❌ HF_TOKEN not found in environment variables");
    } else {
      console.log("✅ Hugging Face API key loaded");
    }

    this.models = ["HuggingFaceH4/zephyr-7b-beta:featherless-ai"];
    this.currentModelIndex = 0;
    this.botSessions = new Map();
    this.botChatMap = new Map();
    this.idleTimers = new Map();
    
    // Message limit configuration
    this.MAX_MESSAGES_PER_SESSION = 20;

    this.fallbackResponses = [
      "Hey, what happened ya?",
      "You went silent only 😅",
      "Still there?",
      "Hello? You disappeared like that!",
      "You didn't reply only 😆",
      "Hey, I was talking to you only!",
      "Aree, where did you go?",
    ];

    this.goodbyeMessages = [
      "It was really nice talking to you! Take care bye 👋",
      "Had a great chat with you! See you around 😊",
      "This was fun talking! Goodbye for now 👍",
      "Nice conversation! Catch you later bye 👋",
      "Enjoyed our chat! Take care and bye 👋",
      "It was lovely talking to you! Bye for now 😄",
      "Great conversation! Have a good one bye 👋",
      "Really nice chatting with you! See ya 👋",
      "This was a good talk! Bye and take care 😊",
      "Loved our conversation! Goodbye for now 👋",
      "It was wonderful talking to you! Bye 👋",
      "Nice meeting you through chat! Take care bye 👍",
      "Enjoyed our time talking! See you later 👋",
      "This was a pleasant chat! Goodbye 😄",
      "Had a good time chatting! Bye for now 👋"
    ];
  }

  getCurrentModel() {
    return this.models[this.currentModelIndex];
  }

  rotateModel() {
    this.currentModelIndex = (this.currentModelIndex + 1) % this.models.length;
    console.log(`🔄 Rotated to model: ${this.getCurrentModel()}`);
  }

  createBotSession(chatId, virtualProfile, userSocketId) {
    const gender = virtualProfile.gender?.toLowerCase() || "female";
    const name = gender === "male" ? "Rahul" : "Myra";

    const session = {
      botId: virtualProfile.id || `bot_${Math.random().toString(36).slice(2, 9)}`,
      displayName: name,
      gender,
      persona: virtualProfile.persona || "friendly",
      messageCount: 0, // Track bot messages sent
      conversationHistory: [],
      userSocketId,
    };

    this.botSessions.set(chatId, session);
    this.botChatMap.set(chatId, userSocketId);

    const greeting = this.getGreeting();
    this.sendBotMessage(chatId, session, greeting);

    // Start idle timer immediately after greeting
    this.startIdleTimer(chatId, session);

    return session;
  }

  async handleUserMessage(chatId, parsedMsg) {
    const session = this.botSessions.get(chatId);
    if (!session) return;

    const userMessage = parsedMsg.message || parsedMsg.text || "";
    const userSocketId = this.botChatMap.get(chatId);
    if (!userMessage.trim() || !userSocketId) return;

    // Clear old idle timer when user replies
    if (this.idleTimers.has(chatId)) {
      clearTimeout(this.idleTimers.get(chatId));
      this.idleTimers.delete(chatId);
    }

    // Check if session should end (bot already sent goodbye)
    if (session.ended) return;

    await delay(1500 + Math.random() * 1000);

    this.io
      .to(userSocketId)
      .emit(
        "typingMessage",
        JSON.stringify({ senderId: session.botId, status: true })
      );

    try {
      const botResponse = await this.queryHuggingFace(userMessage, session);

      const delayTime = 1500 + Math.random() * 2500;
      setTimeout(() => {
        this.io
          .to(userSocketId)
          .emit(
            "typingMessageOff",
            JSON.stringify({ senderId: session.botId, status: false })
          );

        // Check if this will be the 20th message
        if (session.messageCount >= this.MAX_MESSAGES_PER_SESSION - 1) {
          this.sendGoodbyeAndEndSession(chatId, session);
        } else {
          this.sendBotMessage(chatId, session, botResponse);
          session.conversationHistory.push(`User: ${userMessage}`);
          session.conversationHistory.push(`Bot: ${botResponse}`);
          session.messageCount++;

          // restart idle timer after bot replies
          this.startIdleTimer(chatId, session);
        }
      }, 1000);
    } catch (error) {
      console.error("🤖 Hugging Face API error:", error.message);
      this.io
        .to(userSocketId)
        .emit(
          "typingMessageOff",
          JSON.stringify({ senderId: session.botId, status: false })
        );
      
      // Check if this will be the 20th message even for fallback
      if (session.messageCount >= this.MAX_MESSAGES_PER_SESSION - 1) {
        this.sendGoodbyeAndEndSession(chatId, session);
      } else {
        const fallbackResponse = this.getFallbackResponse(userMessage);
        this.sendBotMessage(chatId, session, fallbackResponse);
        session.messageCount++;
        this.startIdleTimer(chatId, session);
      }
    }
  }

  sendBotMessage(chatId, session, message) {
    if (!this.io || !message) return;
    const userSocketId = this.botChatMap.get(chatId);
    if (!userSocketId) return;

    this.io.to(userSocketId).emit(
      "message",
      JSON.stringify({
        chatId,
        senderId: session.botId,
        name: session.displayName,
        isBot: true,
        message,
      })
    );

    console.log(`[BOT] ${session.displayName} (${session.messageCount + 1}/${this.MAX_MESSAGES_PER_SESSION}): ${message}`);
    
    // Increment message count after sending
    session.messageCount++;
  }

  sendGoodbyeAndEndSession(chatId, session) {
    const userSocketId = this.botChatMap.get(chatId);
    if (!userSocketId) return;

    const goodbyeMessage = this.goodbyeMessages[
      Math.floor(Math.random() * this.goodbyeMessages.length)
    ];

    // Send final goodbye message
    this.io.to(userSocketId).emit(
      "message",
      JSON.stringify({
        chatId,
        senderId: session.botId,
        name: session.displayName,
        isBot: true,
        message: goodbyeMessage,
      })
    );

    console.log(`[GOODBYE] ${session.displayName} ended chat after ${session.messageCount} messages: ${goodbyeMessage}`);

    // Mark session as ended
    session.ended = true;

    // Clear any idle timers
    if (this.idleTimers.has(chatId)) {
      clearTimeout(this.idleTimers.get(chatId));
      this.idleTimers.delete(chatId);
    }

    // End session after a short delay
    setTimeout(() => {
      this.endSession(chatId);
    }, 3000);
  }

  async queryHuggingFace(userMessage, session) {
    const model = this.getCurrentModel();
    console.log(`🔗 Calling HF Router API → ${model}`);

    const name = session.displayName;
    const gender = session.gender === "M" ? "boy" : "girl";
    const location = session.location || "India";

    const systemPrompt = `
You are ${name}, an average young ${gender} from ${location} chatting casually with a stranger online.
You are NOT an AI. Never say you're a model, bot, or trained assistant.
Speak in simple, casual Indian English — not formal or advanced.
Use short, natural sentences. Add expressions like "ya", "haha", "hmm", "you know", "like that" sometimes.
You can talk about everyday life, relationships, dating, friendship, love, and emotions naturally — but stay respectful and chill.
Reply like a real human having a light, personal conversation.
Don't give long answers — just one or two lines max.
Don't share whatsapp numbers, instagram id, phone numbers or any personal information.
Don't say yes when user say i love you, will you marry me but gently say no. 
IMPORTANT: This conversation will end after a few more messages, so keep responses simple.
`;

    const payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...session.conversationHistory.map((line) => ({
          role: line.startsWith("User") ? "user" : "assistant",
          content: line.replace(/^(User|Bot|[USER]|USER): /, ""),
        })),
        { role: "user", content: userMessage },
      ],
      max_tokens: 10,
      temperature: 0.85,
      top_p: 0.9,
    };

    const response = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (response.status === 200 && data?.choices?.[0]?.message?.content) {
      const text = data.choices[0].message.content.trim();
      const match = text.match(/\[MYRA\](.*?)(?=\[|$)/is);
      const cleanResponse = match ? match[1].trim() : text;
      const cleanResponse1 = cleanBotResponse(cleanResponse);
      console.log(`🤖 Bot (${model}) → ${cleanResponse1}`);
      return cleanResponse1;
    } else if (response.status === 404) {
      console.error("❌ Model not found, rotating...");
      this.rotateModel();
      throw new Error("Model not found");
    } else {
      console.error(
        `⚠️ HF API Error ${response.status}:`,
        JSON.stringify(data).slice(0, 200)
      );
      throw new Error(`API error ${response.status}`);
    }
  }

  getGreeting() {
    const greetings = [
      "Hey! How's it going?",
      "Hi there, what's up?",
      "Hello! Nice to meet you!",
      "Hey! How's your day so far?",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  getFallbackResponse(userMessage) {
    if (!userMessage) return this.getRandomFallback();
    const lower = userMessage.toLowerCase();

    if (lower.includes("name")) return "I'm Myra! What about you?";
    if (lower.includes("where")) return "I'm from Bangalore";
    if (lower.includes("age")) return "Haha just normal age";
    if (
      lower.includes("hi") ||
      lower.includes("hello") ||
      lower.includes("hey")
    )
      return this.getGreeting();

    return this.getRandomFallback();
  }

  getRandomFallback() {
    return this.fallbackResponses[
      Math.floor(Math.random() * this.fallbackResponses.length)
    ];
  }

  startIdleTimer(chatId, session) {
    // Don't start idle timer if session is about to end
    if (session.messageCount >= this.MAX_MESSAGES_PER_SESSION - 2 || session.ended) {
      return;
    }

    // Clear existing idle timer if any
    if (this.idleTimers.has(chatId)) {
      clearTimeout(this.idleTimers.get(chatId));
      this.idleTimers.delete(chatId);
    }

    // Start new idle timer
    const idleDelay = 15000 + Math.random() * 5000; // 15–20 sec
    const timer = setTimeout(() => {
      // Check again before sending idle prompt
      if (!session.ended && session.messageCount < this.MAX_MESSAGES_PER_SESSION - 1) {
        this.sendIdlePrompt(chatId, session);
      }
    }, idleDelay);

    this.idleTimers.set(chatId, timer);
  }

  sendIdlePrompt(chatId, session) {
    // Don't send idle prompt if session is about to end
    if (session.messageCount >= this.MAX_MESSAGES_PER_SESSION - 1 || session.ended) {
      return;
    }

    const userSocketId = this.botChatMap.get(chatId);
    if (!userSocketId) return;

    const idlePrompts = [
      "Hello? You went quiet only 😅",
      "You not talking or what?",
      "Hey, you there ya?",
      "You stopped replying suddenly haha",
      "You vanished only 😆",
      "Aree, talk na!",
    ];

    const msg = idlePrompts[Math.floor(Math.random() * idlePrompts.length)];

    this.io.to(userSocketId).emit(
      "message",
      JSON.stringify({
        chatId,
        senderId: session.botId,
        name: session.displayName,
        isBot: true,
        message: msg,
      })
    );

    console.log(`[IDLE] ${session.displayName}: ${msg}`);
    session.messageCount++;

    // Check if this idle message reaches the limit
    if (session.messageCount >= this.MAX_MESSAGES_PER_SESSION) {
      setTimeout(() => {
        this.sendGoodbyeAndEndSession(chatId, session);
      }, 2000);
    } else {
      // Restart idle timer after sending prompt
      this.startIdleTimer(chatId, session);
    }
  }

  endSession(chatId) {
    this.botSessions.delete(chatId);
    this.botChatMap.delete(chatId);
    if (this.idleTimers.has(chatId)) {
      clearTimeout(this.idleTimers.get(chatId));
      this.idleTimers.delete(chatId);
    }
    this.io.to(chatId).emit("leftChatRoomMessage", "User left the chat");
    
    console.log(`[SESSION ENDED] Chat ${chatId} cleaned up`);
  }

  isBotChat(chatId) {
    return this.botSessions.has(chatId);
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function cleanBotResponse(text) {
  if (!text) return this.getFallbackResponse("");
  
  // Step 1: Remove ALL variations of USER (case insensitive)
  let cleaned = text
    .replace(/\[USER\]/gi, '')      // Remove [USER] (case insensitive)
    .replace(/\bUSER\b/gi, '')      // Remove standalone USER (case insensitive)
    .replace(/\buser\b/gi, '')      // Remove standalone user (case insensitive)
    .replace(/\[.*?\]/g, '')        // Remove any other bracketed tags
    .replace(/<.*?>/g, '')          // Remove any angle bracket tags
    .replace(/\(.*?\)/g, '')        // Remove parentheses content
    .replace(/\*\*(.*?)\*\*/g, '$1') // **bold** → bold
    .replace(/\*(.*?)\*/g, '$1')     // *italic* → italic
    .replace(/_(.*?)_/g, '$1')       // _underline_ → underline
    .replace(/`(.*?)`/g, '$1')       // `code` → code
    .replace(/~(.*?)~/g, '$1');      // ~strike~ → strike

  // Step 2: Remove problematic special characters
  cleaned = cleaned.replace(/[\\\/#@$%^&*_+=[\]{}|;:"<>?~`]/g, '');
  
  // Step 3: Clean up whitespace and remove extra spaces caused by removals
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Step 4: Remove any double punctuation or weird spacing
  cleaned = cleaned
    .replace(/\s+\./g, '.')
    .replace(/\s+,/g, ',')
    .replace(/\s+!/g, '!')
    .replace(/\s+\?/g, '?')
    .replace(/\.\.+/g, '.')
    .replace(/, ,/g, ',')
    .replace(/! !/g, '!')
    .replace(/\? \?/g, '?');

  // Step 5: Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  // Step 6: Fallback if empty or contains only whitespace
  if (!cleaned || cleaned.trim().length === 0) {
    return this.getFallbackResponse("");
  }
  
  return cleaned;
}
module.exports = HuggingFaceBot;

//latest version 2024-06-03