import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { twiml as Twiml } from 'twilio';
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const DEFAULT_STT_LANG = process.env.DEFAULT_STT_LANG || 'en-US';
const DEFAULT_VOICE = process.env.DEFAULT_VOICE || 'Polly.Nicole';
const WAKE_PROMPT = process.env.SANDY_WAKE_PROMPT || "Hi, this is Sandy. I can translate, give directions, or help you book things. What do you need?";

// health
app.get('/', (req, res) => res.send('Sandy webhook is alive'));
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Entry point for incoming calls
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

  // If no speech detected, fallback
  response.redirect({ method: 'POST' }, '/fallback');
  res.type('text/xml').send(response.toString());
});

// Process user's speech and reply simply (placeholder for LLM)
app.post('/process', (req, res) => {
  const userText = (req.body.SpeechResult || '').trim();
  const response = new Twiml.VoiceResponse();

  let reply;
  if (!userText) {
    response.redirect({ method: 'POST' }, '/voice');
  } else {
    // Very simple intent demo
    const lower = userText.toLowerCase();
    if (lower.includes('bus') || lower.includes('terminal')) {
      reply = "The main bus terminal is Pattaya Bus Terminal on North Pattaya Road. Do you want directions or a taxi there?";
    } else if (lower.includes('taxi')) {
      reply = "Okay. I can help you book a taxi. Tell me your pickup location and time.";
    } else if (lower.includes('translate')) {
      reply = "Say the sentence you want me to translate and tell me the target language, for example, translate to Thai.";
    } else {
      reply = `You said: ${userText}. I can help with directions, translation, and local tips.`;
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

  res.type('text/xml').send(response.toString());
});

// If nothing captured
app.post('/fallback', (req, res) => {
  const response = new Twiml.VoiceResponse();
  response.say({ voice: DEFAULT_VOICE }, "Sorry, I didn't catch that.");
  response.redirect({ method: 'POST' }, '/voice');
  res.type('text/xml').send(response.toString());
});

app.listen(PORT, () => console.log(`Sandy webhook listening on :${PORT}`));
