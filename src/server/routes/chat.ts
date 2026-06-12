import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AgentLoop } from '../../agent/loop.js';
import type { KoaConfig } from '../../config/index.js';
import type { SseEvent } from '../events.js';
import { routeResponse } from '../../channels/router.js';
import { synthesizeStream } from '../../voice/tts.js';

export interface ChatRouterDeps {
  loop: AgentLoop;
  config: KoaConfig;
  isBusy: () => boolean;
  setIsBusy: (v: boolean) => void;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function briefify(event: SseEvent): SseEvent {
  if (event.type !== 'tool_result') return event;
  return { ...event, result: stripAnsi(event.result).slice(0, 500) };
}

function modelToTier(model: string): string {
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('opus')) return 'opus';
  return 'sonnet';
}

function sanitizeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Strip absolute paths (including segments with spaces) to avoid leaking file system structure
  return msg.replace(/([A-Za-z]:)?(\/[\w.\- ]+)+/g, '[path]').slice(0, 200);
}

// Shared SSE streaming logic used by both POST /api/chat and GET /api/sse/chat.
function runChatStream(
  loop: AgentLoop,
  message: string,
  req: Request,
  res: Response,
  opts: { brief?: boolean; setIsBusy: (v: boolean) => void },
): void {
  const { brief = false, setIsBusy } = opts;
  let disconnected = false;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Tell Caddy/nginx not to buffer this response — required for SSE through a reverse proxy.
  // Without this, Caddy's gzip encoder buffers the stream and the browser never receives events.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Use res 'close' (not req 'close') — on Node.js 20, req 'close' fires as soon as the
  // POST body is consumed, before the async turn completes, making every res.write a no-op.
  res.on('close', () => {
    disconnected = true;
    setIsBusy(false);
  });

  const send = (event: SseEvent) => {
    if (!disconnected) res.write(`data: ${JSON.stringify(brief ? briefify(event) : event)}\n\n`);
  };

  let didStreamContent = false;

  loop
    .turn(message, {
      onToolCall: (name, input) => send({ type: 'tool_call', name, input }),
      onToolResult: (name, result) => send({ type: 'tool_result', name, result }),
      onClassifying: () => send({ type: 'classifying' }),
      onClassified: (tier) => send({ type: 'classified', tier }),
      onTextDelta: (delta) => { didStreamContent = true; send({ type: 'content', text: delta }); },
      onChainStart: (agent) => send({ type: 'chain_start', agent }),
    })
    .then((result) => {
      if (!didStreamContent) send({ type: 'content', text: result.content });
      if (result.usage) {
        send({ type: 'usage', turn: result.usage, session: loop.getState().usage, contextStats: loop.contextStats() });
      }
      send({
        type: 'done',
        turnCount: loop.getState().turnCount,
        model: result.model,
        tier: result.tier,
        agent: result.agent,
        ...(result.classifierLatencyMs !== undefined
          ? { classifierLatencyMs: result.classifierLatencyMs }
          : {}),
      });
      if (!disconnected) res.end();
      // Notify when Koa is waiting for user response (end_turn = agent stopped, not mid-tool-loop)
      if (result.stopReason === 'end_turn') {
        const preview = result.content.slice(0, 200).replace(/\n+/g, ' ');
        void routeResponse('input_required', 'Koa needs your input', preview);
      }
    })
    .catch((err: unknown) => {
      console.error('[koa] agent error:', err);
      send({ type: 'error', message: `Agent error — ${sanitizeErrorMessage(err)}` });
      if (!disconnected) res.end();
    })
    .finally(() => {
      setIsBusy(false);
    });
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const router = Router();
  const { loop, config, isBusy, setIsBusy } = deps;

  router.get('/context', (_req, res) => {
    const state = loop.getState();
    res.json({
      context: state.engramContext,
      model: config.model,
      turnCount: state.turnCount,
      engramEnabled: config.engramEnabled,
      activeModel: state.lastModel ?? config.model,
      activeTier: state.lastTier ?? modelToTier(config.model),
      activeAgent: state.lastAgent ?? 'code-assistant',
      usage: state.usage,
      spiderBrain: state.spiderBrainContext ?? null,
      conversationId: loop.getConversationId(),
    });
  });

  router.post('/checkpoint', (_req, res) => {
    if (isBusy()) {
      res.status(409).json({ error: 'Agent turn in progress — retry after current response finishes' });
      return;
    }
    loop
      .checkpoint()
      .then(() => res.json({ status: 'ok', message: 'Checkpoint saved.' }))
      .catch((err: unknown) => {
        console.error('[koa] checkpoint error:', err);
        res.status(500).json({ error: 'Internal server error' });
      });
  });

  router.post('/chat', (req, res) => {
    const message = (req.body as { message?: string }).message;
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (isBusy()) {
      res.status(429).json({ error: 'Agent is busy — wait for the current response to finish' });
      return;
    }
    setIsBusy(true);
    runChatStream(loop, message, req, res, { setIsBusy });
  });

  router.get('/voice/synthesize', (req: Request, res: Response) => {
    const text = (req.query as Record<string, string>)['text'];
    if (!text?.trim()) {
      res.status(400).json({ error: 'text required' });
      return;
    }
    if (text.length > 500) {
      res.status(400).json({ error: 'text too long (max 500 chars)' });
      return;
    }

    synthesizeStream(text, {
      provider: config.ttsProvider,
      elevenLabsVoiceId: config.elevenLabsVoiceId,
      elevenLabsModel: config.elevenLabsModel,
    })
      .then(({ stream, contentType }) => {
        res.setHeader('Content-Type', contentType);
        stream.pipe(res);
        stream.on('error', () => { if (!res.headersSent) res.status(503).json({ error: 'TTS stream error' }); });
      })
      .catch(() => {
        if (!res.headersSent) res.status(503).json({ error: 'TTS not available' });
      });
  });

  // iOS URLSession / native EventSource can only issue GET requests for SSE.
  // Message arrives as a query param; ?format=brief strips ANSI and caps tool
  // output at 500 chars, keeping payloads small for mobile data.
  router.get('/sse/chat', (req, res) => {
    const q = req.query as Record<string, string>;
    const message = q['message'];
    const brief = q['format'] === 'brief';

    if (!message?.trim()) {
      res.status(400).json({ error: 'message query param is required' });
      return;
    }
    if (isBusy()) {
      res.status(429).json({ error: 'Agent is busy — wait for the current response to finish' });
      return;
    }
    setIsBusy(true);
    runChatStream(loop, message, req, res, { brief, setIsBusy });
  });

  return router;
}
