import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// readline/promises mock — must be declared before any import of the module
// ---------------------------------------------------------------------------
const mockQuestion = vi.fn<(query: string) => Promise<string>>();
const mockClose = vi.fn<() => void>();

vi.mock('readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
}));

// ---------------------------------------------------------------------------
// We dynamically import the module under test so the mock is in place first.
// ---------------------------------------------------------------------------
async function importSetup() {
  // Force a fresh module load (vitest caches by default in the same worker).
  return import('../cli/setup.js');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function queueAnswers(...answers: string[]): void {
  let call = 0;
  mockQuestion.mockImplementation((_query: string) => {
    const answer = answers[call] ?? '';
    call++;
    return Promise.resolve(answer);
  });
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-setup-test-'));
  process.env['KOA_HOME'] = tmpDir;
  mockQuestion.mockReset();
  mockClose.mockReset();
  // Clear module cache so each test gets a fresh import if needed
  vi.resetModules();
});

afterEach(() => {
  delete process.env['KOA_HOME'];
  delete process.env['ANTHROPIC_API_KEY'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Headless — no API key → process.exit(1), error mentions ANTHROPIC_API_KEY
// ---------------------------------------------------------------------------
describe('headless mode', () => {
  it('exits 1 and prints error when no API key is present', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ headless: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errMsg: string = (errorSpy.mock.calls[0] as [string])[0];
    expect(errMsg).toContain('ANTHROPIC_API_KEY');
  });

  // 2. Headless — API key in env → exits cleanly
  it('succeeds when ANTHROPIC_API_KEY is in env', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-xxxxxxxxxxxxxxxxxxxx';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ headless: true });

    expect(exitSpy).not.toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));
  });

  // 3. Headless — API key in credentials file → exits cleanly
  it('succeeds when ANTHROPIC_API_KEY is in credentials file', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    // Write credentials file directly
    const koaDir = path.join(tmpDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(path.join(koaDir, 'credentials'), 'ANTHROPIC_API_KEY=sk-ant-fromfile12345\n');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ headless: true });

    expect(exitSpy).not.toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));
  });
});

// ---------------------------------------------------------------------------
// Interactive mode tests
// ---------------------------------------------------------------------------
describe('interactive mode', () => {
  // 4. API key validation — invalid key loops; valid key is saved
  it('loops on invalid API key prefix, accepts valid key', async () => {
    // Answers: bad key, bad key, good key, then generate token, empty name, skip ntfy, skip project path
    queueAnswers(
      'not-valid',
      'sk-ant-tooshort',
      'sk-ant-validkeyabcdef1234',
      'g',
      '',
      '',
      '',
    );

    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ reset: false });

    const koaDir = path.join(tmpDir, '.koa');
    const creds = fs.readFileSync(path.join(koaDir, 'credentials'), 'utf8');
    expect(creds).toContain('ANTHROPIC_API_KEY=sk-ant-validkeyabcdef1234');
  });

  // 5. Web token auto-generate — empty input generates a 64-char hex token
  it('generates a 64-char hex token on empty input', async () => {
    // API key first, then empty for generate, then name, ntfy skip, path skip
    queueAnswers(
      'sk-ant-validkeyabcdef1234',
      '',
      '',
      '',
      '',
    );

    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ reset: false });

    const koaDir = path.join(tmpDir, '.koa');
    const creds = fs.readFileSync(path.join(koaDir, 'credentials'), 'utf8');
    const match = creds.match(/KOA_WEB_TOKEN=([a-f0-9]+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toHaveLength(64);
  });

  // 6. Web token manual entry too short → re-prompts; ≥16 chars saved
  it('rejects token < 16 chars and accepts token >= 16 chars', async () => {
    queueAnswers(
      'sk-ant-validkeyabcdef1234',
      'short',          // <16, rejected
      'validtoken1234567890', // >=16, accepted
      '',
      '',
      '',
    );

    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ reset: false });

    const koaDir = path.join(tmpDir, '.koa');
    const creds = fs.readFileSync(path.join(koaDir, 'credentials'), 'utf8');
    expect(creds).toContain('KOA_WEB_TOKEN=validtoken1234567890');
  });

  // 7. ntfy topic with invalid chars → re-prompts on '@' in topic name
  it('rejects ntfy topic with @ and retries', async () => {
    queueAnswers(
      'sk-ant-validkeyabcdef1234',
      'g',
      '',
      'bad@topic',      // invalid chars
      '',               // blank on retry → skip
      '',
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ reset: false });

    const invalidMsg = (errorSpy.mock.calls as [string][]).some(([m]) =>
      m.toLowerCase().includes('invalid topic'),
    );
    expect(invalidMsg).toBe(true);
  });

  // 8. ntfy valid topic + URL validation — private IP re-prompts; valid URL saves
  it('rejects private IP for ntfy URL and accepts public URL', async () => {
    queueAnswers(
      'sk-ant-validkeyabcdef1234',
      'g',
      '',
      'my-alerts',
      'https://192.168.1.1',  // private IP — rejected
      'https://ntfy.sh',      // valid
      '',
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ reset: false });

    const hadPrivateError = (errorSpy.mock.calls as [string][]).some(([m]) =>
      m.toLowerCase().includes('invalid url') || m.toLowerCase().includes('private'),
    );
    expect(hadPrivateError).toBe(true);

    const hadSuccess = (logSpy.mock.calls as [string][]).some(([m]) =>
      m.includes('ntfy configured'),
    );
    expect(hadSuccess).toBe(true);

    const koaDir = path.join(tmpDir, '.koa');
    const creds = fs.readFileSync(path.join(koaDir, 'credentials'), 'utf8');
    expect(creds).toContain('NTFY_TOPIC=my-alerts');
    expect(creds).toContain('NTFY_BASE_URL=https://ntfy.sh');
  });

  // 9. Idempotency — with API key already set and no --reset, step 1 is skipped
  it('skips API key step when already set and reset is false', async () => {
    // Pre-populate API key
    const koaDir = path.join(tmpDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(
      path.join(koaDir, 'credentials'),
      'ANTHROPIC_API_KEY=sk-ant-existing1234567\n',
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Remaining steps: token, name, ntfy skip, path skip
    queueAnswers('g', '', '', '');

    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ reset: false });

    const skippedMsg = (logSpy.mock.calls as [string][]).some(([m]) =>
      m.includes('API key already set'),
    );
    expect(skippedMsg).toBe(true);
    // API key question should never have been asked
    const apiKeyPromptCalled = (mockQuestion.mock.calls as [string][]).some(([q]) =>
      q.includes('sk-ant-'),
    );
    expect(apiKeyPromptCalled).toBe(false);
  });

  // 10. --reset flag — with API key already set and --reset, step 1 prompts again
  it('re-prompts for API key when --reset is set', async () => {
    const koaDir = path.join(tmpDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(
      path.join(koaDir, 'credentials'),
      'ANTHROPIC_API_KEY=sk-ant-existing1234567\n',
    );

    queueAnswers(
      'sk-ant-resetkeyabcdef1234', // new API key
      'g',                          // generate token
      '',                           // name default
      '',                           // skip ntfy
      '',                           // skip project path
    );

    const { runSetupWizard } = await importSetup();
    await runSetupWizard({ reset: true });

    const creds = fs.readFileSync(path.join(koaDir, 'credentials'), 'utf8');
    expect(creds).toContain('ANTHROPIC_API_KEY=sk-ant-resetkeyabcdef1234');
  });
});
