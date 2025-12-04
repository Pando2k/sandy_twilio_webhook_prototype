require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { twiml: Twiml } = require('twilio');
const WebSocket = require('ws');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const DEFAULT_STT_LANG = process.env.DEFAULT_STT_LANG || 'en-US';
const DEFAULT_VOICE    = process.env.DEFAULT_VOICE    || 'alice';
const WAKE_PROMPT      = process.env.SANDY_WAKE_PROMPT || 'Hi there, Sandy is listening…';

const SESAME_WS_URL = process.env.SESAME_WS_URL;     // e.g., wss://realtime.sesamehub.ai/v1/agent
const SESAME_API_KEY = process.env.SESAME_API_KEY;   // Bearer key

// --- Health checks ---
app.get('/', (_, res) => res.send('OK'));
app.get('/health', (_, res) => res.send('healthy'));

// --- REPLACED: Instead of <Gather>, use <Connect><Stream> to open a media stream ---
app.post('/voice', (req, res) => {
  const vr = new Twiml.VoiceResponse();

  // Say a quick wake prompt, then connect stream
  vr.say({ voice: DEFAULT_VOICE }, WAKE_PROMPT);

  const connect = vr.connect();
  connect.stream({
    url: `wss://${req.get('host')}/stream`, // Twilio connects to our /stream WS
    track: 'inbound_audio'                  // Twilio will send caller audio
    // If your Twilio account supports bidirectional streams, the same socket can send audio back
  });

  res.type('text/xml').send(vr.toString());
});

// --- WebSocket endpoint Twilio will connect to ---
const server = app.listen(PORT, () => {
  console.log(`Sandy realtime bridge listening on ${PORT}`);
});
const wss = new WebSocket.Server({ noServer: true });

// Upgrade HTTP -> WS for /stream
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Utility: create a Sesame realtime WS and attach event handlers
function connectSesame() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SESAME_WS_URL, {
      headers: { Authorization: `Bearer ${SESAME_API_KEY}` }
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// NOTE: Twilio sends JSON frames: {event:"start"|"media"|"stop", ...}
// media.payload is base64 PCMU (μ-law) @ 8kHz
wss.on('connection', async (twilioWS) => {
  console.log('[Twilio] stream connected');

  // Connect to Sesame realtime (Maya)
  let sesameWS;
  try {
    sesameWS = await connectSesame();
    console.log('[Sesame] connected');
  } catch (e) {
    console.error('[Sesame] connect error:', e?.message || e);
    twilioWS.close();
    return;
  }

  // --- Send an initial "session start"/config to Sesame (pseudo-API; adjust to Sesame docs) ---
  // Example: tell Sesame we're sending 8k μ-law audio and want Thai/English code-switching
  const initMsg = {
    type: 'session.start',
    input_audio_format: { codec: 'mulaw', sample_rate_hz: 8000 },
    output_audio_format: { codec: 'mulaw', sample_rate_hz: 8000 },
    persona: {
      name: 'Sandy',
      locale_hint: 'th-TH,en-US',
      style: 'friendly, warm, tour guide, concise',
      backchannels: true,
      barge_in: true
    }
  };
  sesameWS.send(JSON.stringify(initMsg));

  // Handle Twilio -> Sesame audio
  twilioWS.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.event === 'start') {
        console.log('[Twilio] start:', data.start?.streamSid);
        // Optionally notify Sesame a new turn started
        sesameWS.send(JSON.stringify({ type: 'stream.start', streamSid: data.start?.streamSid }));
      }

      if (data.event === 'media' && data.media?.payload) {
        // Forward base64 μ-law frames to Sesame
        sesameWS.send(JSON.stringify({
          type: 'input_audio',
          audio: data.media.payload, // base64 μ-law 8k
          streamSid: data.streamSid
        }));
      }

      if (data.event === 'stop') {
        console.log('[Twilio] stop');
        sesameWS.send(JSON.stringify({ type: 'stream.stop' }));
        // Close after short delay to flush
        setTimeout(() => {
          try { sesameWS.close(); } catch {}
          try { twilioWS.close(); } catch {}
        }, 250);
      }
    } catch (e) {
      console.error('Twilio WS parse error:', e?.message || e);
    }
  });

  // Handle Sesame -> Twilio audio (bidirectional accounts only)
  sesameWS.on('message', (raw) => {
    try {
      const evt = JSON.parse(raw.toString());

      // Pseudo-protocol: Sesame emits base64 μ-law chunks as {type:'output_audio', audio:'...'}
      if (evt.type === 'output_audio' && evt.audio) {
        // Send audio back to caller over Twilio Media Streams (bidirectional)
        // Twilio expects: { event: 'media', media: { payload: base64Mulaw } }
        const frame = JSON.stringify({ event: 'media', media: { payload: evt.audio } });
        try { twilioWS.send(frame); } catch (e) { console.error('send back error', e); }
      }

      // For partial transcripts / debug logs
      if (evt.type === 'transcript.partial') {
        console.log('[Sesame partial]', evt.text);
      }
      if (evt.type === 'transcript.final') {
        console.log('[Sesame final]', evt.text);
      }
    } catch (e) {
      console.error('Sesame WS parse error:', e?.message || e);
    }
  });

  const cleanup = () => {
    try { sesameWS?.close(); } catch {}
    try { twilioWS?.close(); } catch {}
  };
  sesameWS.on('close', () => { console.log('[Sesame] closed'); cleanup(); });
  sesameWS.on('error', (e) => { console.error('[Sesame] error', e?.message || e); cleanup(); });
  twilioWS.on('close', () => { console.log('[Twilio] socket closed'); cleanup(); });
  twilioWS.on('error', (e) => { console.error('[Twilio] socket error', e?.message || e); cleanup(); });
});
