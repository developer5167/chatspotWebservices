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
    this.idleTimers = new Map(); // 🕒 track inactivity

    this.fallbackResponses = [
      "Hey, what happened ya?",
      "You went silent only 😅",
      "Still there?",
      "Hello? You disappeared like that!",
      "You didn’t reply only 😆",
      "Hey, I was talking to you only!",
      "Aree, where did you go?",
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
      botId:
        virtualProfile.id || `bot_${Math.random().toString(36).slice(2, 9)}`,
      displayName: name,
      gender,
      persona: virtualProfile.persona || "friendly",
      messageCount: 0,
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

    await delay(1500 + Math.random() * 1000); // natural response delay

    this.io
      .to(userSocketId)
      .emit(
        "typingMessage",
        JSON.stringify({ senderId: session.botId, status: true })
      );

    try {
      const botResponse = await this.queryHuggingFace(userMessage, session);

      const delayTime = 1500 + Math.random() * 2500; // 1.5–4 sec realistic delay
      setTimeout(() => {
        this.io
          .to(userSocketId)
          .emit(
            "typingMessageOff",
            JSON.stringify({ senderId: session.botId, status: false })
          );

        this.sendBotMessage(chatId, session, botResponse);
        session.conversationHistory.push(`User: ${userMessage}`);
        session.conversationHistory.push(`Bot: ${botResponse}`);
        session.messageCount++;

        // restart idle timer after bot replies
        this.startIdleTimer(chatId, session);
      }, 1000);
    } catch (error) {
      console.error("🤖 Hugging Face API error:", error.message);
      this.io
        .to(userSocketId)
        .emit(
          "typingMessageOff",
          JSON.stringify({ senderId: session.botId, status: false })
        );
      const fallbackResponse = this.getFallbackResponse(userMessage);
      this.sendBotMessage(chatId, session, fallbackResponse);
      this.startIdleTimer(chatId, session);
    }
  }

  async queryHuggingFace(userMessage, session) {
    const model = this.getCurrentModel();
    console.log(`🔗 Calling HF Router API → ${model}`);

    const name = session.displayName;
    const gender = session.gender === "M" ? "boy" : "girl";

    const systemPrompt = `
You are ${name}, an average young ${gender} from India chatting casually with a stranger online.
You are NOT an AI. Never say you're a model, bot, or trained assistant.
Speak in simple, casual Indian English — not formal or advanced.
Use short, natural sentences. Add expressions like "ya", "haha", "hmm", "you know", "like that" sometimes.
You can talk about everyday life, relationships, dating, friendship, love, and emotions naturally — but stay respectful and chill.
Reply like a real human having a light, personal conversation.
Don't give long answers — just one or two lines max.
`;

    const payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...session.conversationHistory.map((line) => ({
          role: line.startsWith("User") ? "user" : "assistant",
          content: line.replace(/^(User|Bot): /, ""),
        })),
        { role: "user", content: userMessage },
      ],
      max_tokens: 100,
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

      console.log(`🤖 Bot (${model}) → ${cleanResponse}`);
      return cleanResponse;
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

    console.log(`[BOT] ${session.displayName}: ${message}`);
  }

  getGreeting() {
    const greetings = [
      "Hey! How’s it going?",
      "Hi there, what’s up?",
      "Hello! Nice to meet you!",
      "Hey! How’s your day so far?",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  getFallbackResponse(userMessage) {
    if (!userMessage) return this.getRandomFallback();
    const lower = userMessage.toLowerCase();

    if (lower.includes("name")) return "I'm Myra! What about you?";
    if (lower.includes("where")) return "I'm from Bangalore only ya!";
    if (lower.includes("age")) return "Haha just normal age only 😅";
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
    // Clear existing idle timer if any
    if (this.idleTimers.has(chatId)) {
      clearTimeout(this.idleTimers.get(chatId));
      this.idleTimers.delete(chatId);
    }

    // Start new idle timer
    const idleDelay = 9000 + Math.random() * 3000; // 9–12 sec
    const timer = setTimeout(() => {
      this.sendIdlePrompt(chatId, session);
    }, 15000);

    this.idleTimers.set(chatId, timer);
  }

  sendIdlePrompt(chatId, session) {
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
  }

  endSession(chatId) {
    this.botSessions.delete(chatId);
    this.botChatMap.delete(chatId);
    if (this.idleTimers.has(chatId)) {
      clearTimeout(this.idleTimers.get(chatId));
      this.idleTimers.delete(chatId);
    }
  }

  isBotChat(chatId) {
    return this.botSessions.has(chatId);
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = HuggingFaceBot;
