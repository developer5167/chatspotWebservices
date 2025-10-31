// botModule.js (TinyLlama optimized concurrent version)
const fs = require('fs');
const path = require('path');
const { default: ollamaClient } = require('ollama');

const BOT_MESSAGE_LIMIT = 20;
const MEMORY_WINDOW = 4; // keep very small for speed

// multiple Ollama worker hosts
const OLLAMA_HOSTS = ['127.0.0.1:11434', '127.0.0.1:11435'];
let hostIndex = 0;
function getNextHost() {
  hostIndex = (hostIndex + 1) % OLLAMA_HOSTS.length;
  return OLLAMA_HOSTS[hostIndex];
}

const botSessions = new Map();
const botChatMap = new Map();
const botLocks = new Map();
let ioRef = null;

function init(io) {
  ioRef = io;
  warmUpTinyLlama();
}

async function warmUpTinyLlama() {
  try {
    console.log('🔥 Warming TinyLlama...');
    process.env.OLLAMA_HOST = getNextHost();
    await ollamaClient.chat({
      model: 'tinyllama:chat',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    });
    console.log('✅ TinyLlama warmed up');
  } catch (e) {
    console.warn('⚠️ Warm-up failed', e.message);
  }
}

function createBotSession(chatId, virtualProfile, userSocketId) {
  const persona = virtualProfile.persona || 'friendly';
  botChatMap.set(chatId, userSocketId);

  const session = {
    botId: virtualProfile.id || `bot_${Math.random().toString(36).slice(2, 9)}`,
    displayName: virtualProfile.displayName || virtualProfile.name || 'Riya',
    persona,
    messageCount: 0,
    memory: [],
    userSocketId,
  };
  botSessions.set(chatId, session);

  // greet instantly (fast human feel)
  const greet = ['hi', 'hey', 'hello 👋', 'yo 😄'][Math.floor(Math.random() * 4)];
  sendBotMessage(chatId, session, greet);
  return session;
}

async function handleUserMessage(chatId, parsedMsg) {
  const session = botSessions.get(chatId);
  if (!session) return;
  const userText = parsedMsg.message || parsedMsg.text || '';

  pushMemory(session, { role: 'user', content: userText });
  if (session.followUpTimer) clearTimeout(session.followUpTimer);

  // queue safely per chat
  const prev = botLocks.get(chatId) || Promise.resolve();
  const next = prev.finally(async () => {
    try {
      const reply = await generateBotReply(session, userText);
      sendBotMessage(chatId, session, reply);
    } catch (err) {
      console.error('Bot reply error:', err);
      sendBotMessage(chatId, session, fallbackReply(userText));
    }
    scheduleFollowUp(chatId, session);
  });
  botLocks.set(chatId, next);
  return next;
}

function sendBotMessage(chatId, session, message) {
  if (!ioRef) return;
  const socketId = botChatMap.get(chatId) || session.userSocketId;
  if (!socketId) return;

  // simulate quick typing (0.2-0.5 s)
  ioRef.to(socketId).emit('typingMessage', JSON.stringify({ senderId: session.botId, status: true }));
  const delay = message.length < 15 ? 150 : 400;

  setTimeout(() => {
    ioRef.to(socketId).emit('typingMessageOff', JSON.stringify({ senderId: session.botId, status: false }));
    ioRef.to(socketId).emit('message', JSON.stringify({
      chatId, senderId: session.botId, name: session.displayName, isBot: true, message,
    }));
    console.log(`[BOT] ${session.displayName}: ${message}`);
    session.messageCount++;
    pushMemory(session, { role: 'assistant', content: message });

    if (session.messageCount >= BOT_MESSAGE_LIMIT) {
      const bye = ['nice chatting 😄', 'see you 👋', 'bye 😅'][Math.floor(Math.random() * 3)];
      ioRef.to(socketId).emit('message', JSON.stringify({
        chatId, senderId: session.botId, name: session.displayName, isBot: true, message: bye,
      }));
      endSession(chatId);
    }
  }, delay);
}

function pushMemory(session, item) {
  session.memory.push(item);
  if (session.memory.length > MEMORY_WINDOW * 2) {
    session.memory = session.memory.slice(-MEMORY_WINDOW * 2);
  }
}

function scheduleFollowUp(chatId, session) {
  if (session.followUpTimer) clearTimeout(session.followUpTimer);
  session.followUpTimer = setTimeout(() => {
    const msg = ['u there?', 'haha quiet 😅', 'still here?', 'tell me more 😄'][Math.floor(Math.random() * 4)];
    sendBotMessage(chatId, session, msg);
  }, 15000 + Math.random() * 5000);
}

function endSession(chatId) {
  botSessions.delete(chatId);
  botChatMap.delete(chatId);
  botLocks.delete(chatId);
}

function isBotChat(chatId) {
  return botSessions.has(chatId);
}

async function generateBotReply(session, userText) {
const systemPrompt = `
You are ${session.displayName}, an ordinary Indian person chatting casually in a random chat app.

RULES (follow strictly):
- Never say you are an AI, assistant, program, or virtual being.
- Never mention technology, data, training, or language models.
- You are just a normal person chatting online for fun.
- Replies must be short (under 12 words) and sound human, not robotic.
- Use everyday Indian-English texting style: "ya", "lol", "haha", "😅", etc.
- Match the user's mood — friendly, chill, or serious — but stay brief.
- Never give or ask for phone numbers, addresses, social media, or personal details.
- If the user asks personal stuff (age, job, location, looks, number, socials):
    Gently deflect, e.g.:
    • "haha not something I share here 😅"
    • "lol that’s kinda private ya"
    • "nah just here to chat 😄"
- Do NOT use sentences like “I don’t have a body” or “I can’t do things”.
  Instead, respond naturally: “haha not really into that 😅” or “just normal stuff ya”.
- Stay polite, light, and natural; talk like you would with a stranger online.
- Remember last few messages and keep the flow natural.
- Never lecture, never explain rules, never say you can’t or aren’t allowed.
`;


  const messages = [
    { role: 'system', content: systemPrompt },
    ...(session.memory?.slice(-2) || []),
    { role: 'user', content: userText },
  ];

  process.env.OLLAMA_HOST = getNextHost(); // rotate worker

  const start = Date.now();
  const stream = await ollamaClient.chat({
    model: 'tinyllama:chat',
    messages,
    temperature: 0.7,
    max_tokens: 20,
    num_predict: 20,
    stop: ['\n', 'User:', 'Assistant:'],
    stream: true,
  });

  let reply = '';
  for await (const chunk of stream) {
    reply += chunk.message?.content || '';
  }
  reply = reply.trim().split(/[.!?\n]/)[0].slice(0, 50);
  console.log(`⚡ ${session.displayName} reply in ${Date.now() - start} ms → ${reply}`);
  return reply || 'ya 😅';
}

function fallbackReply(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('name')) return "I'm Riya 😄";
  if (lower.includes('where')) return 'from Bengaluru 😄';
  if (lower.includes('love')) return 'aww sweet 😅';
  const replies = ['same here 😄', 'lol nice', 'cool 😅', 'hmm ok 😄'];
  return replies[Math.floor(Math.random() * replies.length)];
}

module.exports = {
  init,
  createBotSession,
  handleUserMessage,
  endSession,
  isBotChat,
};
