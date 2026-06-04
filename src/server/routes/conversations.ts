import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  listConversations,
  getConversation,
  getConversationTurns,
  deleteConversationsBefore,
  searchConversations,
} from '../../db/index.js';
import type { ConversationTurn, Conversation } from '../../db/index.js';

export function createConversationsRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const limit = 50;
    res.json(listConversations(limit));
  });

  router.get('/search', (req: Request, res: Response) => {
    const q = ((req.query['q'] as string | undefined) ?? '').trim();
    if (!q) { res.status(400).json({ error: 'q parameter required' }); return; }
    const hits = searchConversations(q);
    const convCache = new Map<string, Conversation | null>();
    const results = hits.map((h) => {
      if (!convCache.has(h.conversationId)) {
        convCache.set(h.conversationId, getConversation(h.conversationId));
      }
      const conv = convCache.get(h.conversationId);
      return { ...h, title: conv?.title ?? null, started_at: conv?.started_at ?? null };
    });
    res.json(results);
  });

  router.get('/:id', (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const conv = getConversation(id);
    if (!conv) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(conv);
  });

  router.get('/:id/turns', (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const conv = getConversation(id);
    if (!conv) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(getConversationTurns(id));
  });

  router.get('/:id/export', (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const format = (req.query['format'] as string) ?? 'json';
    const conv = getConversation(id);
    if (!conv) { res.status(404).json({ error: 'Not found' }); return; }
    const turns = getConversationTurns(id);

    if (format === 'markdown') {
      const lines: string[] = [
        `# Conversation${conv.title ? `: ${conv.title}` : ''}`,
        `**Started:** ${conv.started_at}${conv.ended_at ? `  **Ended:** ${conv.ended_at}` : ''}`,
        `**Turns:** ${conv.turn_count}`,
        '',
      ];
      for (const turn of turns) {
        const role = turn.role === 'user' ? '**User**' : '**Koa**';
        const meta = turn.model ? ` *(${turn.model}${turn.agent_name ? `, ${turn.agent_name}` : ''})*` : '';
        lines.push(`### ${role}${meta}`);
        lines.push(`*${turn.created_at}*`);
        lines.push('');
        lines.push(turn.content);
        const rawToolUses = (() => { try { return JSON.parse(turn.tool_uses) as unknown[]; } catch { return []; } })();
        if (rawToolUses.length > 0) {
          const names = rawToolUses.map((t) =>
            t && typeof t === 'object' && 'name' in t ? String((t as Record<string, unknown>)['name']) : '?'
          ).join(', ');
          lines.push('');
          lines.push(`*Tool calls: ${names}*`);
        }
        lines.push('');
        lines.push('---');
        lines.push('');
      }
      const filename = `conversation-${id.slice(0, 8)}.md`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'text/markdown');
      res.send(lines.join('\n'));
      return;
    }

    // Default: JSON
    res.json({ conversation: conv, turns });
  });

  router.delete('/', (req: Request, res: Response) => {
    const before = req.query.before as string | undefined;
    if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      res.status(400).json({ error: 'before parameter required (YYYY-MM-DD)' });
      return;
    }
    const deleted = deleteConversationsBefore(before);
    res.json({ deleted });
  });

  return router;
}
