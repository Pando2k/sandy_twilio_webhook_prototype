require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { twiml: Twiml } = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const DEFAULT_STT_LANG = process.env.DEFAULT_STT_LANG || "en-US";
const DEFAULT_VOICE = process.env.DEFAULT_VOICE || "en-US-Neural2-C";
const WAKE_PROMPT = process.env.SANDY_WAKE_PROMPT || "Hello, how can I help you?";

// health check
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('healthy'));

// entry point for incoming calls
app.post('/voice', (req, res) => {
  const response = new Twiml.VoiceResponse();

  const gather = response.gather({
    input: 'speech',
    speechTimeout: 'auto',
    language: DEFAULT_STT_LANG,
    action: '/process',
    method: 'POST'
  });

  gather.say({ voice: DEFAULT_VOICE }, WAKE_PROMPT);

  res.type('text/xml');
  res.send(response.toString());
});

// process speech
app.post('/process', (req, res) => {
  const userText = (req.body.SpeechResult || "").trim();
  const response = new Twiml.VoiceResponse();

  let reply;
  if (!userText) {
    response.redirect({ method: 'POST' }, '/voice');
  } else {
    const lower = userText.toLowerCase();

    if (lower.includes('bus')) {
      reply = "The main bus terminal is near Victory Monument.";
    } else if (lower.includes('taxi')) {
      reply = "Okay. I can help you book a taxi. Where do you want to go?";
    } else if (lower.includes('translate')) {
      reply = "Say the sentence you want me to translate.";
    } else {
      reply = `You said: ${userText}. How else can I assist?`;
    }

    const gather = response.gather({
      input: 'speech',
      speechTimeout: 'auto',
      language: DEFAULT_STT_LANG,
      action: '/process',
      method: 'POST'
    });

    gather.say({ voice: DEFAULT_VOICE }, reply);
  }

  res.type('text/xml');
  res.send(response.toString());
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
