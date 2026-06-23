import express, { Router } from 'express';
import type { Request, Response } from 'express';
import type { AgentLoop } from '../../agent/loop.js';
import type { KoaConfig } from '../../config/index.js';
import { loadIntegrations } from '../../integrations/store.js';
import { isDuplicate, markProcessed, contentHash } from '../../channels/dedup.js';
import { parseTwilioBody, validateTwilioSignature } from '../../channels/sms.js';
import { validateSlackSignature, parseSlackInbound, replyToSlack } from '../../channels/slack.js';
import { extractIntent } from '../../channels/gmail.js';
import { listProjects, createTask } from '../../db/index.js';
import { transcribeAudio } from '../../voice/whisper.js';
import { synthesizeStream, cleanText } from '../../voice/tts.js';
import { readCredentials } from '../../config/credentials.js';

export interface WebhooksRouterDeps {
  loop: AgentLoop;
  config: KoaConfig;
  // rawBodyMap is needed by the Slack webhook to access the raw request body
  // (parsed before express.json strips it). Passed in from index.ts.
  rawBodyMap: WeakMap<object, Buffer>;
}

const ALLOWED_AUDIO_TYPES = ['audio/wav', 'audio/m4a', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/mp4'];

// Webhook router handles /webhooks/slack and /webhooks/sms (channel-specific auth).
export function createWebhooksRouter(deps: WebhooksRouterDeps): Router {
  const router = Router();
  const { loop, config, rawBodyMap } = deps;

  // ── POST /slack — Slack Events API + slash commands ───────────────────────────
  // Raw body is captured via the verify callback on the global express.json() middleware in
  // index.ts and stored in rawBodyMap, keyed by the IncomingMessage object. This avoids the
  // express.raw() route-level workaround, which was broken: express.json() sets req._body = true
  // on first parse, causing express.raw() to skip the body entirely.

  router.post('/slack', (req: Request, res: Response) => {
    const rawBody = rawBodyMap.get(req)?.toString('utf8') ?? '';

    // Parse body — may be JSON (Events API) or URL-encoded (slash commands)
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      parsed = Object.fromEntries(new URLSearchParams(rawBody));
    }

    // Validate HMAC signature FIRST — before reading any body fields or sending responses.
    // This ensures url_verification challenges (and all other requests) are authenticated
    // before we act on them. Previously the url_verification branch ran before this check,
    // allowing unauthenticated callers to probe the endpoint (SEC-002).
    const allSlacks = loadIntegrations().filter(i => i.type === 'slack' && i.status === 'connected');
    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
    const signature = req.headers['x-slack-signature'] as string | undefined;

    let matchedSlack: (typeof allSlacks)[0] | undefined;
    if (timestamp && signature) {
      for (const s of allSlacks) {
        const signingSecret = s.config['signingSecret'];
        if (signingSecret && validateSlackSignature(signingSecret, rawBody, timestamp, signature)) {
          matchedSlack = s;
          break;
        }
      }
    }

    if (!matchedSlack) {
      res.status(401).json({ error: 'Invalid Slack signature' });
      return;
    }

    // url_verification challenge — signature is now confirmed valid before we echo anything.
    // Guard the challenge value to a safe alphanumeric format before reflecting it.
    if (parsed['type'] === 'url_verification') {
      const challenge = parsed['challenge'];
      if (typeof challenge !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(challenge)) {
        res.status(400).json({ error: 'Invalid challenge format' });
        return;
      }
      res.json({ challenge });
      return;
    }

    const inbound = parseSlackInbound(parsed);
    if (!inbound) {
      res.status(200).send();
      return;
    }

    // For slash commands: acknowledge immediately, then process async
    if (inbound.type === 'slash_command') {
      res.status(200).json({ text: 'Thinking…', response_type: 'ephemeral' });
    } else {
      res.status(200).send();
    }

    void (async () => {
      try {
        const result = await loop.turn(inbound.text);
        if (!result.content) return;
        const botToken = matchedSlack.config['botToken'];
        const replyOpts: { responseUrl?: string; channelId?: string; botToken?: string } = {
          channelId: inbound.channelId,
        };
        if (inbound.responseUrl) replyOpts.responseUrl = inbound.responseUrl;
        if (botToken && botToken !== '***') replyOpts.botToken = botToken;
        await replyToSlack(result.content, replyOpts);
      } catch (err) {
        process.stderr.write(`[webhooks/slack] error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    })();
  });

  // ── POST /sms — Twilio inbound SMS ────────────────────────────────────────────

  router.post('/sms', (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const integrations = loadIntegrations();
    const twilio = integrations.find(i => i.type === 'twilio' && i.status === 'connected');

    if (!twilio?.config['authToken']) {
      res.status(403).type('text/xml').send('<Response/>');
      return;
    }
    const sig = req.headers['x-twilio-signature'] as string | undefined;
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    if (!sig || !validateTwilioSignature(twilio.config['authToken'], url, body, sig)) {
      res.status(403).type('text/xml').send('<Response/>');
      return;
    }

    const msg = parseTwilioBody(body);
    if (!msg.externalId) { res.type('text/xml').send('<Response/>'); return; }

    if (isDuplicate('sms', msg.externalId)) {
      res.type('text/xml').send('<Response/>');
      return;
    }

    const hash = contentHash(msg.body);
    const apiKey = config.apiKey;

    (apiKey ? extractIntent(msg.body, apiKey) : Promise.resolve({ type: 'unknown' as const, content: msg.body }))
      .then(async intent => {
        if (intent.type === 'task' && intent.content) {
          const projects = listProjects();
          const project = intent.project
            ? projects.find(p => p.name.toLowerCase().includes((intent.project ?? '').toLowerCase()))
            : projects[0];
          if (project) {
            createTask(project.id, intent.content, {
              description: `Via SMS from ${msg.from}`,
              ...(intent.deadline ? { deadline: intent.deadline } : {}),
              ...(intent.priority ? { priority: intent.priority } : {}),
            });
          }
        }
        markProcessed('sms', msg.externalId, hash, intent.type);
      })
      .catch(e => console.error('[webhooks/sms]', e));

    res.type('text/xml').send('<Response/>');
  });

  return router;
}

// Voice router handles POST /transcribe (mounted at /api/voice in index.ts).
// Content-Type whitelist and size check are enforced here; the actual Whisper
// API call delegates to transcribeAudio() from src/voice/whisper.ts.
export function createVoiceRouter(deps: Pick<WebhooksRouterDeps, 'rawBodyMap'>): Router {
  const router = Router();
  const { rawBodyMap } = deps;

  // ── GET /tts-status — check if ElevenLabs TTS is available ──────────────────
  router.get('/tts-status', (_req: Request, res: Response) => {
    const creds = readCredentials();
    const available = !!creds['ELEVENLABS_API_KEY'];
    res.json({ available });
  });

  // ── POST /tts — synthesize text to audio/mpeg via ElevenLabs ─────────────────
  // Input is capped at 2000 chars before cleanText (which further slices to 500).
  // This prevents large-payload regex work even though express.json() has a 100KB default limit.
  router.post('/tts', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const rawText = body['text'];

    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      res.status(400).json({ error: 'text must be a non-empty string' });
      return;
    }

    // Explicit length gate before regex processing in cleanText
    if (rawText.length > 2000) {
      res.status(400).json({ error: 'text exceeds maximum length' });
      return;
    }

    const text = cleanText(rawText);

    if (text.length === 0) {
      res.status(400).json({ error: 'text must be a non-empty string' });
      return;
    }

    try {
      const { stream, contentType } = await synthesizeStream(text, { provider: 'elevenlabs' });
      res.setHeader('Content-Type', contentType);
      // Attach an error handler on the stream before piping so that errors emitted
      // after headers are already sent do not propagate to the uncaughtException handler.
      stream.on('error', (err) => {
        console.error('[koa/tts] stream error after pipe started:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'TTS synthesis failed' });
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ELEVENLABS_API_KEY not configured')) {
        res.status(503).json({ error: 'ElevenLabs not configured' });
      } else {
        console.error('[koa/tts] synthesis error:', err);
        res.status(500).json({ error: 'TTS synthesis failed' });
      }
    }
  });

  router.post('/transcribe', express.raw({ limit: '26mb', type: () => true }), async (req: Request, res: Response) => {
    // Check API key is configured before accepting the audio upload
    const creds = readCredentials();
    const apiKey = process.env['OPENAI_API_KEY'] ?? creds['OPENAI_API_KEY'];
    if (!apiKey) {
      res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
      return;
    }

    const contentType = req.headers['content-type'] ?? 'audio/wav';
    const baseMime = (contentType.split(';')[0] ?? '').trim();
    const safeContentType = ALLOWED_AUDIO_TYPES.includes(baseMime) ? baseMime : 'audio/wav';

    const rawBody = Buffer.isBuffer(req.body) ? req.body : (rawBodyMap.get(req) ?? null);

    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({ error: 'No audio data received' });
      return;
    }

    if (rawBody.length > 25 * 1024 * 1024) {
      res.status(413).json({ error: 'Audio exceeds 25MB limit' });
      return;
    }

    try {
      const text = await transcribeAudio(rawBody, safeContentType);
      res.json({ text });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Whisper API returned an error')) {
        res.status(502).json({ error: err.message });
      } else {
        console.error('[koa] transcribe error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  return router;
}
