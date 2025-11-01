// botModule_chroma_extended.js
// Extended persona bot using Chroma + Xenova (when available) + conversationPatterns
// CommonJS style to match your project

const fs = require('fs');
const path = require('path');
const { ChromaClient } = require('chromadb');
const convo = require('./conversationPatterns');

// Initialize ChromaDB client for v2
const chroma = new ChromaClient({
  path: "http://localhost:8000"
});

let embedder = null;
const VIRTUAL_USERS_FILE = path.join(__dirname, 'virtual_users.json');

const BOT_MESSAGE_LIMIT = 60;
const MEMORY_WINDOW = 8;
const N_CONTEXT = 3;
const COLLECTION_PREFIX = 'persona_';

let virtualUsers = [];
try {
  virtualUsers = JSON.parse(fs.readFileSync(VIRTUAL_USERS_FILE, 'utf8'));
  console.log(`Loaded ${virtualUsers.length} virtual profiles`);
} catch (e) {
  console.warn('virtual_users.json missing or invalid. Using fallback single profile.');
  virtualUsers = [{
    id: 'fallback_1',
    name: 'Natasha',
    gender: 'F',
    city: 'Mumbai',
    profession: 'Student',
    hobby: 'listening to music',
    persona: 'friendly',
  }];
}

// Test ChromaDB connection on startup
async function testChromaConnection() {
  try {
    const collections = await chroma.listCollections();
    console.log('✅ ChromaDB v2 connected successfully');
    return true;
  } catch (error) {
    console.log('❌ ChromaDB v2 connection failed:', error.message);
    return false;
  }
}

// Initialize connection
testChromaConnection().catch(() => {});

/* ---------- Chroma v2 helpers ---------- */
async function getOrCreateCollection(profileId) {
  const name = `${COLLECTION_PREFIX}${profileId}`;
  try {
    // Try to get existing collection first
    try {
      const collection = await chroma.getCollection({ name });
      return collection;
    } catch (error) {
      // Collection doesn't exist, create it
      const collection = await chroma.createCollection({ 
        name,
        metadata: { description: `Memory for ${profileId}` }
      });
      return collection;
    }
  } catch (err) {
    console.error('Chroma collection error', err.message);
    return createFallbackCollection(name);
  }
}

async function addMemoryToChroma(profileId, id, text) {
  try {
    await ensureEmbedder();
    const emb = await embedder(text);
    const coll = await getOrCreateCollection(profileId);
    
    await coll.add({
      ids: [id],
      metadatas: [{ ts: Date.now(), role: 'mem' }],
      documents: [text],
      embeddings: [emb],
    });
  } catch (err) {
    console.warn('Chroma addMemory error', err.message);
  }
}

async function queryMemory(profileId, queryText, n = N_CONTEXT) {
  try {
    await ensureEmbedder();
    const emb = await embedder(queryText);
    const coll = await getOrCreateCollection(profileId);
    
    const res = await coll.query({
      queryEmbeddings: [emb],
      nResults: n,
      include: ['documents', 'distances', 'metadatas'],
    });
    
    const docs = (res.documents && res.documents[0]) || [];
    return docs;
  } catch (err) {
    console.warn('Chroma query error', err.message);
    return [];
  }
}

// Fallback storage (keep as backup)
function createFallbackCollection(name) {
  const items = new Map();
  return {
    add: async (data) => {
      data.ids.forEach((id, index) => {
        items.set(id, {
          document: data.documents[index],
          metadata: data.metadatas[index],
          embedding: data.embeddings ? data.embeddings[index] : null
        });
      });
    },
    query: async (queryData) => {
      const results = Array.from(items.values())
        .slice(0, queryData.nResults)
        .map(item => item.document);
      
      return {
        documents: [results],
        distances: [new Array(results.length).fill(0.1)],
        metadatas: [results.map(() => ({}))]
      };
    }
  };
}

// Keep the rest of your existing code unchanged...
// [The rest of your existing functions remain the same]
const sessions = new Map();
const chatToSocket = new Map();
let ioRef = null;

function pickProfile(providedProfile) {
  if (providedProfile) return Object.assign({}, providedProfile);
  if (!virtualUsers || virtualUsers.length === 0) return Object.assign({}, virtualUsers[0]);
  const p = virtualUsers[Math.floor(Math.random() * virtualUsers.length)];
  return Object.assign({}, p);
}

function assignPartner(profile) {
  if (typeof profile.hasPartner !== 'boolean') {
    profile.hasPartner = Math.random() < 0.4;
    const male = ['Aarav','Rohan','Kabir','Aditya','Arjun','Vivaan','Kian'];
    const female = ['Myra','Kiara','Ananya','Ira','Diya','Navya','Aanya'];
    profile.partnerName = profile.hasPartner
      ? (profile.gender && profile.gender.toUpperCase()==='F' ? male[Math.floor(Math.random()*male.length)] : female[Math.floor(Math.random()*female.length)])
      : null;
  }
}

// create session
function createBotSession(chatId, virtualProfile, userSocketId) {
  const profile = pickProfile(virtualProfile);
  assignPartner(profile);

  const session = {
    botId: profile.id || `bot_${Math.random().toString(36).slice(2,9)}`,
    profile,
    displayName: profile.name || 'Keerthi',
    persona: (profile.persona || 'friendly').toLowerCase(),
    createdAt: Date.now(),
    messageCount: 0,
    localMemory: [], // last few text items
    followUpTimer: null,
    userSocketId,
  };

  sessions.set(chatId, session);
  chatToSocket.set(chatId, userSocketId);

const greetings = [
  `hey there`,
  `hello`,
  `hi`,
  `hey, how’s it going?`,
  `hi there, nice to meet you`
];
const greet = greetings[Math.floor(Math.random() * greetings.length)];
  sendBotMessage(chatId, session, greet);

  // persist intro
  pushLocalMemory(session, `intro:${greet}`);
  addMemoryToChroma(session.profile.id || session.botId, `${session.botId}_intro`, `intro:${greet}`).catch(()=>{});
  return session;
}

function pushLocalMemory(session, text) {
  session.localMemory.push(text);
  if (session.localMemory.length > MEMORY_WINDOW * 2) session.localMemory = session.localMemory.slice(-MEMORY_WINDOW * 2);
  // save to chroma async
  addMemoryToChroma(session.profile.id || session.botId, `${session.botId}_${Date.now()}`, text).catch(()=>{});
}

/* ---------- Messaging ---------- */
function sendBotMessage(chatId, session, message) {
  if (!ioRef) return;
  const socketId = chatToSocket.get(chatId) || session.userSocketId;
  if (!socketId) return;
  const out = message ? message.toString().trim().slice(0, 240) : '';

  // emulate typing
  ioRef.to(socketId).emit('typingMessage', JSON.stringify({ senderId: session.botId, status: true }));
  const typing = Math.min(600 + out.length * 8, 1400);

  setTimeout(() => {
    ioRef.to(socketId).emit('typingMessageOff', JSON.stringify({ senderId: session.botId, status: false }));
    ioRef.to(socketId).emit('message', JSON.stringify({
      chatId,
      senderId: session.botId,
      name: session.displayName,
      isBot: true,
      message: out,
    }));
    session.messageCount++;
    pushLocalMemory(session, `bot:${out}`);

    // auto-end guard
    if (session.messageCount >= BOT_MESSAGE_LIMIT) {
      ioRef.to(socketId).emit('message', JSON.stringify({
        chatId, senderId: session.botId, name: session.displayName, isBot: true,
        message: ['nice chatting', 'bye for now', 'see ya'][Math.floor(Math.random()*3)]
      }));
      endSession(chatId);
    }
  }, typing);
}

/* ---------- Intent handling & reply synthesis ---------- */
async function handleUserMessage(chatId, parsedMsg) {
  const session = sessions.get(chatId);
  if (!session) return;
  const text = (parsedMsg.message || parsedMsg.text || '').toString().trim();
  if (!text) return;
  const socketId = chatToSocket.get(chatId);
  if (!socketId) return;

  // cancel follow-up
  if (session.followUpTimer) { clearTimeout(session.followUpTimer); session.followUpTimer = null; }

  // store user message
  pushLocalMemory(session, `user:${text}`);
  addMemoryToChroma(session.profile.id || session.botId, `${session.botId}_u_${Date.now()}`, `user:${text}`).catch(()=>{});

  try {
    // deterministic rule checks (privacy & short replies)
    const ruleReply = handlePrivacyAndBasics(session, text);
    if (ruleReply) {
      sendBotMessage(chatId, session, ruleReply);
      scheduleFollowUp(chatId, session);
      return;
    }

    // detect intent
    const intent = convo.detectIntent(text);

    // quick persona-based reply if intent matched
    if (intent === convo.INTENTS.UNKNOWN && Math.random() < 0.5) {
  const greetResp = convo.getResponseForIntent(session.persona, convo.INTENTS.GREETING_GENERAL, session.profile, '');
  sendBotMessage(chatId, session, greetResp);
  scheduleFollowUp(chatId, session);
  return;
}

    // fallback: use Chroma context similarity to craft a short reply (no LLM)
    const ctxDocs = await queryMemory(session.profile.id || session.botId, text, N_CONTEXT);
    const ctx = (ctxDocs && ctxDocs.length) ? ctxDocs.join(' | ').slice(0, 220) : '';
    const reply = synthesizeFromContext(session, text, ctx);
    sendBotMessage(chatId, session, reply);
    scheduleFollowUp(chatId, session);
  } catch (err) {
    console.error('handleUserMessage error', err.message);
    sendBotMessage(chatId, session, fallbackReply());
    scheduleFollowUp(chatId, session);
  }
}

// strict privacy and basic rule replies
function handlePrivacyAndBasics(session, text) {
  const lower = text.toLowerCase();

  // strict greetings handled by patterns so skip here

  // social or phone asks
  if (/(instagram|facebook|twitter|snapchat|social media|socials|handle|username)/i.test(lower)) {
    return 'nah, not something I share here';
  }
  if (/(phone|number|call me|whatsapp|whats app|whatsapp number|mobile)/i.test(lower)) {
    return 'nah, not something I share here';
  }

  // direct relationship questions: only answer about relation if asked explicitly (pattern already catches)
  if (/(boyfriend|girlfriend|partner|dating)/i.test(lower)) {
    // reply via persona templates using placeholder {relationReply}
    return convo.getResponseForIntent(session.persona, convo.INTENTS.ASK_RELATION, session.profile, '');
  }

  // short exact greetings like "hi" should be handled by intent; no need to extra-handle

  // direct "tell me your socials" style
  if (/(give me your|share your).*(instagram|facebook|phone|number)/i.test(lower)) {
    return 'nope, not sharing that here';
  }

  return null;
}

function synthesizeFromContext(session, text, context) {
  // If context exists, echo a concise reference joined with a short reaction
  if (context && context.length > 6) {
    const piece = context.split('|')[0].replace(/\s+/g,' ').slice(0, 60);
    const shortReacts = {
      friendly: ['oh ya,', 'haha,'],
      witty: ['lol,', 'haha,'],
      chill: ['hmm,', 'ya,'],
      curious: ['oh really,', 'tell me,'],
      reserved: ['hmm,', 'ok,'],
    };
    const react = (shortReacts[session.persona] || ['hmm,'])[Math.floor(Math.random()* (shortReacts[session.persona]?.length || 1))];
    return `${react} ${piece}`.slice(0, 120);
  }

  // otherwise use persona smalltalk or fallback
  const small = convo.getResponseForIntent(session.persona, convo.INTENTS.UNKNOWN, session.profile, '');
  return small;
}

function fallbackReply() {
  return 'hmm ok';
}

/* ---------- idle follow-up ---------- */
function scheduleFollowUp(chatId, session) {
  if (session.followUpTimer) clearTimeout(session.followUpTimer);
  session.followUpTimer = setTimeout(() => {
    // small polite nudge — persona affects phrasing
    const nudges = {
      friendly: ['u there?','still here?'],
      witty: ['u there?','haha quiet'],
      chill: ['still here?','you there?'],
      curious: ['tell me more?','you there?'],
      reserved: ['you?']
    };
    const arr = nudges[session.persona] || nudges.friendly;
    const pick = arr[Math.floor(Math.random()*arr.length)];
    sendBotMessage(chatId, session, pick);
  }, 12000 + Math.random()*9000);
}

/* ---------- session lifecycle ---------- */
function endSession(chatId) {
  const s = sessions.get(chatId);
  if (s && s.followUpTimer) clearTimeout(s.followUpTimer);
  sessions.delete(chatId);
  chatToSocket.delete(chatId);
}
function isBotChat(chatId) { return sessions.has(chatId); }

/* ---------- initialization ---------- */
async function init(io) {
  ioRef = io;
  // warm up embedder async
  ensureEmbedder().catch(()=>{});
  // optionally warm some chroma collections for speed
  // (no-op here)
}
async function ensureEmbedder() {
  if (embedder) return embedder;
  
  try {
    // Dynamic import for ES modules in CommonJS
    const { pipeline } = await Function('return import("@xenova/transformers")')();
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    
    embedder = async (text) => {
      try {
        const out = await extractor(text, { pooling: 'mean', normalize: true });
        if (out?.data) return Array.from(out.data);
        if (Array.isArray(out) && Array.isArray(out[0])) return Array.from(out[0]);
        return simpleTextVector(text);
      } catch (err) {
        console.warn('Xenova embedding failed, using fallback', err.message);
        return simpleTextVector(text);
      }
    };
    console.log('Xenova embedder ready');
    return embedder;
  } catch (err) {
    console.warn('Xenova load failed, using fallback embeddings.', err.message);
    embedder = async (t) => simpleTextVector(t);
    return embedder;
  }
}

module.exports = {
  init,
  createBotSession,
  handleUserMessage,
  endSession,
  isBotChat,
};
