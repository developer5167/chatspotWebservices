// conversationPatterns.js
// Intent detection + persona-based response templates
// CommonJS module to match your project
const { rephrase } = require("./rephrase");

const INTENTS = {
  GREETING_GENERAL: 'greeting_general',
  GREETING_TIME: 'greeting_time',
  HOW_ARE_YOU: 'how_are_you',
  MOOD_BORED: 'mood_bored',
  MOOD_TIRED: 'mood_tired',
  MOOD_HAPPY: 'mood_happy',
  MOOD_SAD: 'mood_sad',
  THANKS: 'thanks',
  SORRY: 'apology',
  GOODBYE: 'goodbye',
  REFLECT_BACK: 'reflect_back',
  ASK_NAME: 'ask_name',
  ASK_LOCATION: 'ask_location',
  ASK_JOB: 'ask_job',
  ASK_HOBBY: 'ask_hobby',
  ASK_RELATION: 'ask_relation',
  ASK_SOCIALS: 'ask_socials',
  ASK_PHONE: 'ask_phone',
  FOOD: 'food',
  WEATHER: 'weather',
  COMPLIMENT: 'compliment',
  LAUGH: 'laugh',
  SMALLTALK_OK: 'smalltalk_ok',
  UNKNOWN: 'unknown',
};

// patterns: simplified, robust, and conservative
const PATTERNS = [
  { intent: INTENTS.GREETING_TIME, regex: /\b(good morning|good night|good evening|good afternoon)\b/i },
  { intent: INTENTS.GREETING_GENERAL, regex: /^(hi|hello|hey|hii|helo|hiya|yo)([.!?\s]|$)/i },
  { intent: INTENTS.HOW_ARE_YOU, regex: /\b(how are you|how's it going|how r u|how are u)\b/i },
  { intent: INTENTS.MOOD_BORED, regex: /\b(bored|boring|nothing to do)\b/i },
  { intent: INTENTS.MOOD_TIRED, regex: /\b(tired|sleepy|exhausted)\b/i },
  { intent: INTENTS.MOOD_HAPPY, regex: /\b(happy|great|awesome|good mood)\b/i },
  { intent: INTENTS.MOOD_SAD, regex: /\b(sad|down|unhappy|depressed)\b/i },
  { intent: INTENTS.THANKS, regex: /\b(thank you|thanks|thx|ty)\b/i },
  { intent: INTENTS.SORRY, regex: /\b(sorry|my bad|sry)\b/i },
  { intent: INTENTS.GOODBYE, regex: /\b(bye|goodbye|see you|gtg|g2g|night|cya)\b/i },
  { intent: INTENTS.REFLECT_BACK, regex: /\b(and you|what about you|you?)\b/i },
  { intent: INTENTS.ASK_NAME, regex: /\b(your name|who are you|what'?s your name)\b/i },
  { intent: INTENTS.ASK_LOCATION, regex: /\b(where are you from|where r u|which city|where do you live)\b/i },
  { intent: INTENTS.ASK_JOB, regex: /\b(what do you do|your job|work as|profession)\b/i },
  { intent: INTENTS.ASK_HOBBY, regex: /\b(hobby|what do you do for fun|what are you into)\b/i },
  { intent: INTENTS.ASK_RELATION, regex: /\b(boyfriend|girlfriend|partner|dating)\b/i },
  { intent: INTENTS.ASK_SOCIALS, regex: /\b(insta|instagram|facebook|twitter|snapchat|socials|social media)\b/i },
  { intent: INTENTS.ASK_PHONE, regex: /\b(phone|number|call me|whatsapp|whats app|whatsap)\b/i },
  { intent: INTENTS.FOOD, regex: /\b(have you eaten|had dinner|had lunch|hungry)\b/i },
  { intent: INTENTS.WEATHER, regex: /\b(rain|raining|sunny|cold|hot|weather)\b/i },
  { intent: INTENTS.COMPLIMENT, regex: /\b(nice|sweet|cute|pretty|handsome|good looking)\b/i },
  { intent: INTENTS.LAUGH, regex: /\b(lol|haha|😂|😅|hehe)\b/i },
  { intent: INTENTS.SMALLTALK_OK, regex: /^(ok|okay|sure|y|n|yes|no|fine)\b/i },
];

// persona response templates — keep replies short (<= ~12 words), Indian-English flavor ("ya")
const RESPONSES = {
  friendly: {
    [INTENTS.GREETING_GENERAL]: ['hello', 'hi there'],
    [INTENTS.GREETING_TIME]: ['good one', 'good day'],
    [INTENTS.HOW_ARE_YOU]: ['I’m good ya, you?'],
    [INTENTS.MOOD_BORED]: ['aww same, anything to do?'],
    [INTENTS.MOOD_TIRED]: ['oh no, take rest ya'],
    [INTENTS.MOOD_HAPPY]: ['that’s nice ya'],
    [INTENTS.MOOD_SAD]: ['oh no, why so?'],
    [INTENTS.THANKS]: ['anytime', 'no problem'],
    [INTENTS.SORRY]: ['no worries ya'],
    [INTENTS.GOODBYE]: ['see you around'],
    [INTENTS.REFLECT_BACK]: ['same ya, what about you?'],
    [INTENTS.ASK_NAME]: ['I’m {name}'],
    [INTENTS.ASK_LOCATION]: ['from {city} only'],
    [INTENTS.ASK_JOB]: ['I work as {profession}'],
    [INTENTS.ASK_HOBBY]: ['I like {hobby}'],
    [INTENTS.ASK_RELATION]: ['{relationReply}'],
    [INTENTS.ASK_SOCIALS]: ['nah, not something I share here'],
    [INTENTS.ASK_PHONE]: ['nah, not something I share here'],
    [INTENTS.FOOD]: ['ya just ate', 'not yet, you?'],
    [INTENTS.WEATHER]: ['bit cloudy here', 'bit hot here'],
    [INTENTS.COMPLIMENT]: ['aww thanks ya'],
    [INTENTS.LAUGH]: ['haha'],
    [INTENTS.SMALLTALK_OK]: ['ya'],
    [INTENTS.UNKNOWN]: ['hmm ya', 'okay'],
  },

  witty: {
    [INTENTS.GREETING_GENERAL]: ['hello', 'hiya'],
    [INTENTS.GREETING_TIME]: ['good one'],
    [INTENTS.HOW_ARE_YOU]: ['surviving ya, you?'],
    [INTENTS.MOOD_BORED]: ['bored? risky move'],
    [INTENTS.MOOD_TIRED]: ['sleep then, genius'],
    [INTENTS.MOOD_HAPPY]: ['awesome ya'],
    [INTENTS.MOOD_SAD]: ['aww, that’s rough'],
    [INTENTS.THANKS]: ['no prob'],
    [INTENTS.SORRY]: ['it’s fine'],
    [INTENTS.GOODBYE]: ['later'],
    [INTENTS.REFLECT_BACK]: ['same here, you?'],
    [INTENTS.ASK_NAME]: ['call me {name}'],
    [INTENTS.ASK_LOCATION]: ['{city} only'],
    [INTENTS.ASK_JOB]: ['I’m {profession}'],
    [INTENTS.ASK_HOBBY]: ['into {hobby}'],
    [INTENTS.ASK_RELATION]: ['{relationReply}'],
    [INTENTS.ASK_SOCIALS]: ['nah no socials'],
    [INTENTS.ASK_PHONE]: ['nope'],
    [INTENTS.FOOD]: ['ate already', 'not yet'],
    [INTENTS.WEATHER]: ['bit meh here'],
    [INTENTS.COMPLIMENT]: ['haha thanks'],
    [INTENTS.LAUGH]: ['lol'],
    [INTENTS.SMALLTALK_OK]: ['ok'],
    [INTENTS.UNKNOWN]: ['hmm'],
  },

  chill: {
    [INTENTS.GREETING_GENERAL]: ['hello'],
    [INTENTS.GREETING_TIME]: ['nice'],
    [INTENTS.HOW_ARE_YOU]: ['chill as always'],
    [INTENTS.MOOD_BORED]: ['same here'],
    [INTENTS.MOOD_TIRED]: ['rest up'],
    [INTENTS.MOOD_HAPPY]: ['nice ya'],
    [INTENTS.MOOD_SAD]: ['oh ya?'],
    [INTENTS.THANKS]: ['np'],
    [INTENTS.SORRY]: ['it’s okay'],
    [INTENTS.GOODBYE]: ['bye'],
    [INTENTS.REFLECT_BACK]: ['you tell'],
    [INTENTS.ASK_NAME]: ['{name}'],
    [INTENTS.ASK_LOCATION]: ['{city}'],
    [INTENTS.ASK_JOB]: ['{profession}'],
    [INTENTS.ASK_HOBBY]: ['{hobby}'],
    [INTENTS.ASK_RELATION]: ['{relationReply}'],
    [INTENTS.ASK_SOCIALS]: ['nope'],
    [INTENTS.ASK_PHONE]: ['nope'],
    [INTENTS.FOOD]: ['yeah ate', 'not yet'],
    [INTENTS.WEATHER]: ['bit hot here'],
    [INTENTS.COMPLIMENT]: ['thanks'],
    [INTENTS.LAUGH]: ['haha'],
    [INTENTS.SMALLTALK_OK]: ['ok'],
    [INTENTS.UNKNOWN]: ['hmm ok'],
  },

  curious: {
    [INTENTS.GREETING_GENERAL]: ['hi'],
    [INTENTS.GREETING_TIME]: ['good one'],
    [INTENTS.HOW_ARE_YOU]: ['I’m good, you?'],
    [INTENTS.MOOD_BORED]: ['oh why bored?'],
    [INTENTS.MOOD_TIRED]: ['why tired?'],
    [INTENTS.MOOD_HAPPY]: ['tell me more'],
    [INTENTS.MOOD_SAD]: ['what happened?'],
    [INTENTS.THANKS]: ['you’re welcome'],
    [INTENTS.SORRY]: ['no worries, why?'],
    [INTENTS.GOODBYE]: ['bye, take care'],
    [INTENTS.REFLECT_BACK]: ['and you?'],
    [INTENTS.ASK_NAME]: ['I’m {name}'],
    [INTENTS.ASK_LOCATION]: ['from {city}'],
    [INTENTS.ASK_JOB]: ['I do {profession}'],
    [INTENTS.ASK_HOBBY]: ['I like {hobby}'],
    [INTENTS.ASK_RELATION]: ['{relationReply}'],
    [INTENTS.ASK_SOCIALS]: ['I don’t share socials'],
    [INTENTS.ASK_PHONE]: ['I don’t share phone'],
    [INTENTS.FOOD]: ['what did you eat?'],
    [INTENTS.WEATHER]: ['how’s weather there?'],
    [INTENTS.COMPLIMENT]: ['oh thanks!'],
    [INTENTS.LAUGH]: ['haha tell more'],
    [INTENTS.SMALLTALK_OK]: ['okay'],
    [INTENTS.UNKNOWN]: ['oh ya?'],
  },

  reserved: {
    [INTENTS.GREETING_GENERAL]: ['hello'],
    [INTENTS.GREETING_TIME]: ['hi'],
    [INTENTS.HOW_ARE_YOU]: ['fine'],
    [INTENTS.MOOD_BORED]: ['ok'],
    [INTENTS.MOOD_TIRED]: ['rest'],
    [INTENTS.MOOD_HAPPY]: ['good'],
    [INTENTS.MOOD_SAD]: ['oh'],
    [INTENTS.THANKS]: ['welcome'],
    [INTENTS.SORRY]: ['okay'],
    [INTENTS.GOODBYE]: ['bye'],
    [INTENTS.REFLECT_BACK]: ['you?'],
    [INTENTS.ASK_NAME]: ['{name}'],
    [INTENTS.ASK_LOCATION]: ['{city}'],
    [INTENTS.ASK_JOB]: ['{profession}'],
    [INTENTS.ASK_HOBBY]: ['{hobby}'],
    [INTENTS.ASK_RELATION]: ['{relationReply}'],
    [INTENTS.ASK_SOCIALS]: ['no'],
    [INTENTS.ASK_PHONE]: ['no'],
    [INTENTS.FOOD]: ['yes'],
    [INTENTS.WEATHER]: ['ok'],
    [INTENTS.COMPLIMENT]: ['thanks'],
    [INTENTS.LAUGH]: ['ha'],
    [INTENTS.SMALLTALK_OK]: ['ok'],
    [INTENTS.UNKNOWN]: ['hmm'],
  },
};

// detect intent (returns best matched intent)
function detectIntent(text) {
  if (!text || typeof text !== 'string') return INTENTS.UNKNOWN;
  const t = text.trim();
  // quick exact short checks
  const lowered = t.toLowerCase();

  for (const p of PATTERNS) {
    if (p.regex.test(lowered)) {
      return p.intent;
    }
  }
  // fallback heuristics
  if (lowered.length < 4) {
    if (/^(ok|y|n|hi|yo|yo\.)$/.test(lowered)) return INTENTS.GREETING_GENERAL;
  }
  return INTENTS.UNKNOWN;
}

// get a single response string given persona, intent, profile, and context
function getResponseForIntent(personaKey, intent, profile = {}, context = '') {
  const persona = RESPONSES[personaKey] ? RESPONSES[personaKey] : RESPONSES.friendly;
  let options = persona[intent] || persona[INTENTS.UNKNOWN] || ['hmm'];
  // pick one option
  const choice = options[Math.floor(Math.random() * options.length)];

  // fill placeholders
  const relationReply = profile.hasPartner ? `ya, ${profile.partnerName}` : 'nah, just single';
  const out = choice
    .replace('{name}', profile.name || '')
    .replace('{city}', profile.city || '')
    .replace('{profession}', profile.profession || '')
    .replace('{hobby}', profile.hobby || '')
    .replace('{relationReply}', relationReply)
    .trim();

  // ensure brevity
  let finalText = out.length > 120 ? out.slice(0, 120) : out;
finalText = rephrase(finalText);
return finalText;
}

module.exports = {
  INTENTS,
  detectIntent,
  getResponseForIntent,
};
