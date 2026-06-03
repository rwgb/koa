import type { Tool } from '../../types/index.js';
import { readCredentials } from '../../config/credentials.js';

const TIMEOUT_MS = 10_000;

interface BraveResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web using Brave Search and return titles, URLs, and snippets for the top results. Follow up with web_fetch to read a full page.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query (1–500 characters)',
      },
      count: {
        type: 'number',
        description: 'Number of results to return (1–10, default 8)',
      },
    },
    required: ['query'],
  },
  async execute(input) {
    const { query, count = 8 } = input as { query: string; count?: number };

    if (!query || typeof query !== 'string' || query.length === 0) {
      throw new Error('query is required');
    }
    if (query.length > 500) throw new Error('query must be 500 characters or fewer');
    const resultCount = Math.min(Math.max(Math.round(count), 1), 10);

    const credentials = readCredentials();
    const apiKey = credentials['BRAVE_API_KEY'] ?? process.env['BRAVE_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'Brave Search API key not found. Set it with: koa config set BRAVE_API_KEY <your-key>',
      );
    }

    const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${resultCount}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          'X-Subscription-Token': apiKey,
          'Accept': 'application/json',
        },
      });
    } catch (e: any) {
      if (e.name === 'AbortError') throw new Error('Search timed out after 10s');
      throw new Error(`Search failed: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error(`Brave Search returned HTTP ${res.status} ${res.statusText}`);

    const data = (await res.json()) as BraveResponse;
    const results = data.web?.results ?? [];

    if (results.length === 0) {
      return `No results found for: "${query}". Try a different query or use web_fetch with a specific URL.`;
    }

    return results
      .map((r, i) => {
        const lines = [`${i + 1}. **${r.title}**`, `   ${r.url}`];
        if (r.description) lines.push(`   ${r.description}`);
        return lines.join('\n');
      })
      .join('\n');
  },
};
