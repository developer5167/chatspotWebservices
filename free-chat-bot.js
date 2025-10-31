// free-chat-bot.js - No API needed!
const https = require('https');
require('dotenv').config();

class FreeChatBot {
    constructor(io) {
        this.io = io;
        this.botSessions = new Map();
        this.botChatMap = new Map();
        
        // Enhanced conversation patterns
        this.conversationPatterns = {
            greetings: ["Hey! 😊", "Hi there!", "Hello!", "Hey! How's it going?", "Hi! What's up?"],
            questions: {
                name: ["I'm Riya! What's your name?", "People call me Riya 😊 What about you?", "I'm Riya! And you?"],
                location: ["I'm from Bengaluru! Where are you from?", "From Bangalore! What about you?", "Bengaluru! You?"],
                work: ["I work in design! What do you do?", "I'm into graphic design! How about you?", "I do freelance design work! You?"],
                hobbies: ["I love music and movies! What about you?", "I enjoy painting and travel! You?", "Big into photography and hiking! Your hobbies?"],
                age: ["Haha I don't share age online 😅", "Let's keep that mystery 😊", "I prefer not to say 😄"]
            },
            responses: {
                positive: ["That's awesome! 😄", "Cool! Tell me more!", "Nice! 😊", "Great! 👏"],
                neutral: ["I see!", "Interesting!", "Hmm okay!", "Got it!"],
                followUp: ["What else do you like?", "How's your day going?", "Tell me something fun!", "What brings you here today?"]
            }
        };
    }

    createBotSession(chatId, virtualProfile, userSocketId) {
        const session = {
            botId: virtualProfile.id || `bot_${Math.random().toString(36).slice(2, 9)}`,
            displayName: virtualProfile.displayName || virtualProfile.name || 'Riya',
            messageCount: 0,
            lastUserMessage: '',
            userSocketId,
        };

        this.botSessions.set(chatId, session);
        this.botChatMap.set(chatId, userSocketId);

        // Send greeting
        const greeting = this.conversationPatterns.greetings[
            Math.floor(Math.random() * this.conversationPatterns.greetings.length)
        ];
        this.sendBotMessage(chatId, session, greeting);

        return session;
    }

    async handleUserMessage(chatId, parsedMsg) {
        const session = this.botSessions.get(chatId);
        if (!session) return;

        const userMessage = parsedMsg.message || parsedMsg.text || '';
        const userSocketId = this.botChatMap.get(chatId);

        if (!userMessage.trim() || !userSocketId) return;

        // Show typing indicator
        this.io.to(userSocketId).emit('typingMessage', JSON.stringify({ 
            senderId: session.botId, 
            status: true 
        }));

        // Simulate thinking time
        const delay = 800 + Math.random() * 1200;
        
        setTimeout(() => {
            this.io.to(userSocketId).emit('typingMessageOff', JSON.stringify({ 
                senderId: session.botId, 
                status: false 
            }));
            
            const response = this.generateSmartResponse(userMessage, session);
            this.sendBotMessage(chatId, session, response);
            session.messageCount++;
            session.lastUserMessage = userMessage;

        }, delay);
    }

    generateSmartResponse(userMessage, session) {
        const lowerMessage = userMessage.toLowerCase();
        
        // Pattern matching for common questions
        if (lowerMessage.includes('name') && !lowerMessage.includes('your')) {
            return this.conversationPatterns.questions.name[
                Math.floor(Math.random() * this.conversationPatterns.questions.name.length)
            ];
        }
        
        if (lowerMessage.includes('where') || lowerMessage.includes('from') || lowerMessage.includes('live')) {
            return this.conversationPatterns.questions.location[
                Math.floor(Math.random() * this.conversationPatterns.questions.location.length)
            ];
        }
        
        if (lowerMessage.includes('work') || lowerMessage.includes('job') || lowerMessage.includes('do for')) {
            return this.conversationPatterns.questions.work[
                Math.floor(Math.random() * this.conversationPatterns.questions.work.length)
            ];
        }
        
        if (lowerMessage.includes('hobby') || lowerMessage.includes('interest') || lowerMessage.includes('like to do')) {
            return this.conversationPatterns.questions.hobbies[
                Math.floor(Math.random() * this.conversationPatterns.questions.hobbies.length)
            ];
        }
        
        if (lowerMessage.includes('age') || lowerMessage.includes('old')) {
            return this.conversationPatterns.questions.age[
                Math.floor(Math.random() * this.conversationPatterns.questions.age.length)
            ];
        }
        
        // Greeting responses
        if (lowerMessage.includes('hi') || lowerMessage.includes('hello') || lowerMessage.includes('hey')) {
            return this.conversationPatterns.greetings[
                Math.floor(Math.random() * this.conversationPatterns.greetings.length)
            ];
        }
        
        // Positive words
        if (lowerMessage.includes('good') || lowerMessage.includes('great') || lowerMessage.includes('nice') || lowerMessage.includes('awesome')) {
            return this.conversationPatterns.responses.positive[
                Math.floor(Math.random() * this.conversationPatterns.responses.positive.length)
            ];
        }
        
        // Default follow-up question
        return this.conversationPatterns.responses.followUp[
            Math.floor(Math.random() * this.conversationPatterns.responses.followUp.length)
        ];
    }

    sendBotMessage(chatId, session, message) {
        if (!this.io || !message) return;

        const userSocketId = this.botChatMap.get(chatId);
        if (!userSocketId) return;

        this.io.to(userSocketId).emit('message', JSON.stringify({
            chatId,
            senderId: session.botId,
            name: session.displayName,
            isBot: true,
            message: message
        }));

        console.log(`[FREE-BOT] ${session.displayName}: ${message}`);
    }

    endSession(chatId) {
        this.botSessions.delete(chatId);
        this.botChatMap.delete(chatId);
    }

    isBotChat(chatId) {
        return this.botSessions.has(chatId);
    }
}

module.exports = FreeChatBot;