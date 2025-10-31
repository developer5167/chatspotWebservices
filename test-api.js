// test-fixed.js
require('dotenv').config();
const fetch = require('node-fetch');

const apiKey = process.env.HUGGINGFACE_API_KEY;

async function testDialoGPT() {
  try {
    console.log('🧪 Testing DialoGPT-medium...');
    
    const response = await fetch(
      "https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: "Hello, how are you?",
          parameters: {
            max_new_tokens: 40,
            temperature: 0.8,
            do_sample: true
          }
        })
      }
    );

    console.log('Status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ SUCCESS! Response:', data);
    } else {
      const error = await response.json();
      console.log('❌ Error:', error);
    }
    
  } catch (error) {
    console.error('Network error:', error.message);
  }
}

testDialoGPT();