import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import type { SseEvent } from './events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(loop: AgentLoop, config: KoaConfig, devPort = 5173) {
  const app = express();
  // Allow requests only from the Vite dev server (dev) or same origin (prod built UI).
  // Never allow wildcard — the bash tool gives full shell access.
  app.use(cors({ origin: `http://localhost:${devPort}` }));
  app.use(express.json());

  let isBusy = false;

  app.get('/api/context', (_req, res) => {
    const state = loop.getState();
    res.json({
      context: state.engramContext,
      model: config.model,
      turnCount: state.turnCount,
      engramEnabled: config.engramEnabled,
      activeModel: state.lastModel ?? config.model,
      activeTier: state.lastTier ?? 'sonnet',
    });
  });

  app.post('/api/chat', (req, res) => {
    const message = (req.body as { message?: string }).message;
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    if (isBusy) {
      res.status(429).json({ error: 'Agent is busy — wait for the current response to finish' });
      return;
    }

    isBusy = true;
    let disconnected = false;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Release the lock immediately if the client disconnects mid-stream
    req.on('close', () => {
      disconnected = true;
      isBusy = false;
    });

    const send = (event: SseEvent) => {
      if (!disconnected) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    loop
      .turn(message, {
        onToolCall: (name, input) => send({ type: 'tool_call', name, input }),
        onToolResult: (name, result) => send({ type: 'tool_result', name, result }),
      })
      .then((result) => {
        send({ type: 'content', text: result.content });
        send({
          type: 'done',
          turnCount: loop.getState().turnCount,
          model: result.model,
          tier: result.tier,
        });
        if (!disconnected) res.end();
      })
      .catch((err: unknown) => {
        // Keep full error server-side; send a sanitised message to the client
        console.error('[koa] agent error:', err);
        send({ type: 'error', message: 'Agent error — see server logs' });
        if (!disconnected) res.end();
      })
      .finally(() => {
        isBusy = false;
      });
  });

  // Serve built web UI; fall back gracefully when not yet built
  const webDist = path.join(__dirname, '../../web/dist');
  app.use(express.static(webDist));
  app.get('/{*path}', (req, res) => {
    const index = path.join(webDist, 'index.html');
    res.sendFile(index, (err) => {
      if (err) {
        res.status(200).send(
          '<pre>Web UI not built yet.\nRun: cd web && npm install && npm run build</pre>',
        );
      }
    });
  });

  return app;
}
