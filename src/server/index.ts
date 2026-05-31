import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import type { SseEvent } from './events.js';
import { projectMemoryPaths } from '../project-memory/paths.js';
import { readMarkdownFile, writeMarkdownFile } from '../project-memory/store.js';
import { loadMemories, addMemory, removeMemory } from '../memory/store.js';

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
      usage: state.usage,
      spiderBrain: state.spiderBrainContext ?? null,
    });
  });

  app.post('/api/checkpoint', (_req, res) => {
    if (isBusy) {
      res.status(409).json({ error: 'Agent turn in progress — retry after current response finishes' });
      return;
    }
    loop
      .checkpoint()
      .then(() => res.json({ status: 'ok', message: 'Checkpoint saved.' }))
      .catch((err: unknown) =>
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) }),
      );
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
        if (result.usage) {
          send({ type: 'usage', turn: result.usage, session: loop.getState().usage });
        }
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

  // ── Admin: config ───────────────────────────────────────────────────────────

  const PM_FILES = ['PROJECT', 'STATE', 'BACKLOG', 'HANDOFF'] as const;
  type PmFile = (typeof PM_FILES)[number];
  const PM_KEY_MAP: Record<PmFile, keyof ReturnType<typeof projectMemoryPaths>> = {
    PROJECT: 'projectMd',
    STATE: 'stateMd',
    BACKLOG: 'backlogMd',
    HANDOFF: 'handoffMd',
  };

  app.get('/api/admin/memory/engram', (_req, res) => {
    const state = loop.getState();
    res.json({
      engram: state.engramContext,
      spiderBrain: state.spiderBrainContext ?? null,
      engramEnabled: config.engramEnabled,
    });
  });

  app.get('/api/admin/memory/files', (_req, res) => {
    const paths = projectMemoryPaths(config.projectPath);
    const files: Record<string, { content: string | null }> = {};
    for (const key of PM_FILES) {
      files[key] = { content: readMarkdownFile(paths[PM_KEY_MAP[key]] as string) };
    }
    res.json({ files, dir: paths.dir });
  });

  app.put('/api/admin/memory/files/:file', (req, res) => {
    const file = ((req.params as { file: string }).file).toUpperCase() as PmFile;
    if (!PM_FILES.includes(file)) {
      res.status(400).json({ error: `Unknown file: ${file}` });
      return;
    }
    const content = (req.body as { content?: string }).content;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content (string) is required' });
      return;
    }
    const paths = projectMemoryPaths(config.projectPath);
    writeMarkdownFile(paths[PM_KEY_MAP[file]] as string, content);
    res.json({ status: 'ok' });
  });

  app.get('/api/admin/memory/facts', (_req, res) => {
    res.json({ facts: loadMemories() });
  });

  app.post('/api/admin/memory/facts', (req, res) => {
    const fact = (req.body as { fact?: string }).fact;
    if (!fact?.trim()) {
      res.status(400).json({ error: 'fact (string) is required' });
      return;
    }
    addMemory(fact.trim());
    res.json({ status: 'ok' });
  });

  app.delete('/api/admin/memory/facts', (req, res) => {
    const fact = (req.body as { fact?: string }).fact;
    if (!fact?.trim()) {
      res.status(400).json({ error: 'fact (string) is required' });
      return;
    }
    const removed = removeMemory(fact.trim());
    if (!removed) {
      res.status(404).json({ error: 'fact not found' });
      return;
    }
    res.json({ status: 'ok' });
  });

  app.post('/api/admin/brain/rebuild', (_req, res) => {
    loop
      .rebuildBrain()
      .then((output) => res.json({ status: 'ok', output }))
      .catch((err: unknown) =>
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) }),
      );
  });

  app.get('/api/admin/activity/sessions', (_req, res) => {
    const paths = projectMemoryPaths(config.projectPath);
    const sessions: { date: string; content: string }[] = [];
    try {
      const files = fs
        .readdirSync(paths.journalDir)
        .filter((f: string) => f.endsWith('.md'))
        .sort()
        .reverse();
      for (const file of files) {
        const content = readMarkdownFile(path.join(paths.journalDir, file));
        if (content) sessions.push({ date: file.replace('.md', ''), content });
      }
    } catch {
      /* journal dir may not exist yet */
    }
    res.json({ sessions });
  });

  app.get('/api/admin/config', (_req, res) => {
    res.json({
      model: config.model,
      maxTokens: config.maxTokens,
      projectPath: config.projectPath,
      engramEnabled: config.engramEnabled,
      smartRouting: config.smartRouting,
      maxToolOutputChars: config.maxToolOutputChars,
      compactAfterTurns: config.compactAfterTurns,
      spiderBrainBrain: config.spiderBrainBrain ?? null,
      autoCheckpointTurns: config.autoCheckpointTurns,
      autoCheckpointMinutes: config.autoCheckpointMinutes,
      apiKeySet: !!config.apiKey,
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
