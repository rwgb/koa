/**
 * Multi-agent chaining: detects when a code-assistant response implies a task
 * state change, enabling an automatic PM follow-up to update the task board.
 */

const COMPLETION_SIGNALS = [
  'completed', 'finished', 'done', 'implemented', 'deployed', 'merged',
  'fixed', 'resolved', 'shipped', 'closed', 'all tests pass', 'tests pass',
  'successfully', 'checkpoint', 'cp',
];

const EXCLUSION_SIGNALS = [
  'not yet', "haven't", 'still need', 'todo', 'pending', 'wip', 'in progress',
  'not complete', 'not done', 'not finished',
];

/**
 * Returns true if the assistant response text implies a task or feature was
 * completed and a PM follow-up would be useful.
 */
export function detectCompletionSignal(responseText: string): boolean {
  const lower = responseText.toLowerCase();
  if (EXCLUSION_SIGNALS.some((s) => lower.includes(s))) return false;
  return COMPLETION_SIGNALS.some((s) => lower.includes(s));
}

/**
 * Builds the follow-up prompt to send to the PM agent after a code-assistant
 * response with completion signals. Includes a brief excerpt of the code
 * response so the PM agent has context.
 */
export function buildPmFollowUpPrompt(codeResponse: string): string {
  const excerpt = codeResponse.slice(0, 600).replace(/\n{3,}/g, '\n\n');
  return (
    `The code assistant just completed work. Review the summary below and briefly confirm ` +
    `which tasks on the board should be updated to "done" or "in_progress", then do it.\n\n` +
    `Code assistant summary:\n${excerpt}`
  );
}
