import type { KoaConfig } from '../config/index.js';
import type { SandboxRunner } from './runner.js';
import { LocalRunner } from './local.js';
import { DockerRunner } from './docker.js';

export { LocalRunner, UnsupportedLanguageError } from './local.js';
export { DockerRunner } from './docker.js';
export type { SandboxRunner, ExecOpts, ExecResult } from './runner.js';

export function createRunner(config: KoaConfig): SandboxRunner {
  const local = new LocalRunner();
  if (config.sandboxBackend === 'docker') {
    return new DockerRunner(local);
  }
  return local;
}
