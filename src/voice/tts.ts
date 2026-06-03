import { spawn, spawnSync } from 'child_process';

/** Speak text using macOS `say` command. Non-blocking — fires and forgets. */
export function speak(text: string): void {
  // Strip markdown and truncate for speech
  const clean = text
    .replace(/```[\s\S]*?```/g, 'code block omitted')
    .replace(/[*_`#>]/g, '')
    .slice(0, 500);
  spawn('say', ['-v', 'Samantha', '--', clean], { stdio: 'ignore', detached: true }).unref();
}

export function isTtsAvailable(): boolean {
  try {
    return spawnSync('which', ['say']).status === 0;
  } catch {
    return false;
  }
}
