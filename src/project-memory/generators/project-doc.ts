import Anthropic from '@anthropic-ai/sdk';
import type { SpiderBrainContext } from '../../types/index.js';
import { HAIKU_MODEL } from '../../config/index.js';

export async function generateProjectDoc(
  projectPath: string,
  sbContext: SpiderBrainContext,
  apiKey: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const hotFilesList =
    sbContext.hotFiles.length > 0
      ? sbContext.hotFiles.slice(0, 10).join('\n')
      : '(SpiderBrain not yet available — hot files unknown)';

  const preyLine = sbContext.available ? `\nProject purpose: ${sbContext.prey}` : '';

  const prompt = `You are documenting a software project for use as a persistent AI memory file.

Project path: ${projectPath}${preyLine}

SpiderBrain hot files (most central to this project):
${hotFilesList}

Write a PROJECT.md for this project. It will be injected into every AI coding session as the primary briefing document. Be concise — this must fit in a system prompt.

Output ONLY the markdown. Start with: # PROJECT: <project name>

Include these sections:
## Tech Stack
## Architecture
## Key Conventions
## Entry Points
## Known Constraints

Target: 300–500 words.`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return text.startsWith('#') ? text : `# PROJECT\n\n${text}`;
}
