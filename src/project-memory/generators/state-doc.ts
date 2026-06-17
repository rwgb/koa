import Anthropic from '@anthropic-ai/sdk';
import { MODEL_MAP } from '../../types/index.js';

export async function generateStateDoc(
  conversationSummary: string,
  turnCount: number,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      // tier: fast — STATE.md generation (internal, non-user-facing)
      model: MODEL_MAP.fast,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Based on this session (${turnCount} turns), write a STATE.md capturing what is currently in-flight.

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
  } catch {
    const date = new Date().toISOString().slice(0, 10);
    return `# STATE — Last updated: ${date}\n\n*(unavailable — API quota or network error)*`;
  }

  const date = new Date().toISOString().slice(0, 10);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return `# STATE — Last updated: ${date}\n\n${text}`;
}

function extractUserMessages(summary: string): string[] {
  return summary
    .split('\n')
    .filter((line) => line.startsWith('User: '))
    .map((line) => line.slice(6).trim())
    .filter(Boolean);
}

export async function generateJournalEntry(
  conversationSummary: string,
  turnCount: number,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const userMessages = extractUserMessages(conversationSummary);

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      // tier: fast — journal entry generation (internal, non-user-facing)
      model: MODEL_MAP.fast,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `You are writing a memory journal for a personal AI assistant. Future sessions read this journal to recall past conversations. Accuracy matters — be specific.

Session transcript (${turnCount} turns):
${conversationSummary}

Write a journal entry. The MOST IMPORTANT thing is capturing what the USER said — use their actual words and topics. Do not describe Koa's behavior in vague terms like "handled off-topic queries."

Output ONLY the journal body using this structure (omit empty sections):

### What User Asked / Discussed
- [specific topic or question — use the user's actual words]

### Resolved
- [what was answered, created, or completed — be concrete]

### Personal / Preferences
- [personal info or preferences the user expressed — omit if none]

### Next
- [ ] [open follow-up or action]

100–200 words max.`,
        },
      ],
    });
  } catch {
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const verbatim = userMessages.length > 0
      ? `**User said:**\n${userMessages.map((m) => `- ${m}`).join('\n')}\n\n`
      : '';
    return `## ${date} ${time} (${turnCount} turns)\n\n${verbatim}*(journal unavailable — API quota or network error)*`;
  }

  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Prepend verbatim user messages so future sessions always know what was said,
  // even if the generated summary is imperfect.
  const verbatim = userMessages.length > 0
    ? `**User said:**\n${userMessages.map((m) => `- ${m}`).join('\n')}\n\n`
    : '';

  return `## ${date} ${time} (${turnCount} turns)\n\n${verbatim}${text}`;
}
