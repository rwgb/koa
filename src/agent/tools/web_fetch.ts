import type { Tool } from '../../types/index.js';
import { validateSafeUrl } from '../../utils/ssrf.js';

const MAX_BYTES = 50_000;
const TIMEOUT_MS = 20_000;

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description:
    'Fetch a URL and return its content as clean markdown. Handles JS-rendered pages and dynamic content via Jina Reader. Use web_search to find URLs first, then web_fetch to read the full page.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The HTTPS URL to fetch (must be https://, max 2048 chars)',
      },
    },
    required: ['url'],
  },
  async execute(input) {
    const { url } = input as { url: string };

    if (!url || typeof url !== 'string') throw new Error('url is required');
    if (url.length > 2048) throw new Error('URL exceeds 2048 character limit');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Malformed URL: ${url}`);
    }
    if (parsed.protocol !== 'https:') throw new Error('Only https:// URLs are allowed');
    validateSafeUrl(url);

    const jinaUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(jinaUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/plain',
          'X-Return-Format': 'markdown',
          'User-Agent': 'Koa/1.0',
        },
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') throw new Error(`Request timed out after ${TIMEOUT_MS / 1000}s`);
      throw new Error(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);

    // Stream body and stop after MAX_BYTES to avoid loading unbounded responses into memory.
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let totalBytes = 0;

    try {
      while (totalBytes < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        chunks.push(chunk);
        totalBytes += value.byteLength;
      }
    } finally {
      reader.cancel();
    }

    return chunks.join('').slice(0, MAX_BYTES);
  },
};
