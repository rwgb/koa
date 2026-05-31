import Anthropic from '@anthropic-ai/sdk';
import { HAIKU_MODEL } from '../../config/index.js';

export async function generateStateDoc(
  conversationSummary: string,
  turnCount: number,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Based on this coding session (${turnCount} turns), write a STATE.md capturing what is currently in-flight.

Session summary:
${conversationSummary}

Output ONLY markdown using this exact structure (omit empty sections):

## In Progress
- [ ] item

## Decided This Session
- decision: rationale

## What Didn't Work
- attempt: reason

## Next Session
- [ ] task

## Known Issues
- issue`,
      },
    ],
  });

  const date = new Date().toISOString().slice(0, 10);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return `# STATE — Last updated: ${date}\n\n${text}`;
}

export async function generateJournalEntry(
  conversationSummary: string,
  turnCount: number,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Write a concise journal entry for a coding session (${turnCount} turns).

Summary:
${conversationSummary}

Output ONLY the markdown entry (no heading — the caller adds the date heading):

### Accomplished
- what was completed

### Decisions
- decision: rationale

### What Didn't Work
- attempt: reason

### Next
- [ ] what to do next session

150–250 words max. Omit empty sections.`,
      },
    ],
  });

  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return `## ${date} ${time} (${turnCount} turns)\n\n${text}`;
}
