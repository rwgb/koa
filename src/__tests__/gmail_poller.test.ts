import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ── constants mirrored from source ───────────────────────────────────────────
// Keep in sync with src/channels/gmail.ts
const RATE_LIMIT_MAX = 20;

// ── hoisted shared spy references (available inside vi.mock factories) ────────
const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ type: 'unknown', content: 'x' }) }],
  }),
}));

// ── imap-simple mock ──────────────────────────────────────────────────────────
// Factory is self-contained; the returned connection is re-configured per-test.

vi.mock('imap-simple', () => ({
  connect: vi.fn().mockResolvedValue({
    openBox: vi.fn().mockResolvedValue('INBOX'),
    search: vi.fn().mockResolvedValue([]),
    end: vi.fn(),
  }),
}));

// ── googleapis mock ───────────────────────────────────────────────────────────

vi.mock('googleapis', () => {
  const OAuth2 = vi.fn(function (this: Record<string, unknown>) {
    this['setCredentials'] = vi.fn();
    this['getAccessToken'] = vi.fn().mockResolvedValue({ token: 'fake-access-token' });
  });
  return { google: { auth: { OAuth2 } } };
});

// ── dedup mock ────────────────────────────────────────────────────────────────

vi.mock('../channels/dedup.js', () => ({
  isDuplicate: vi.fn().mockReturnValue(false),
  markProcessed: vi.fn(),
  contentHash: vi.fn().mockReturnValue('fake-hash'),
}));

// ── db mock ───────────────────────────────────────────────────────────────────

vi.mock('../db/index.js', () => ({
  createTask: vi.fn(),
  listProjects: vi.fn().mockReturnValue([
    { id: 'proj-1', name: 'Default Project', slug: 'default-project' },
  ]),
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

// ── integrations/store mock ───────────────────────────────────────────────────

vi.mock('../integrations/store.js', () => ({
  loadIntegrations: vi.fn(() => [
    {
      id: 'gmail-1',
      type: 'gmail',
      name: 'Gmail',
      status: 'connected',
      config: {
        email: 'user@example.com',
        clientId: 'fake-client-id',
        clientSecret: 'fake-client-secret',
        refreshToken: 'fake-refresh-token',
      },
    },
  ]),
  saveIntegration: vi.fn(),
}));

// ── Anthropic mock — uses hoisted spy so tests can re-configure it ────────────

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockAnthropicCreate };
    constructor(_opts: unknown) {}
  },
}));

// ── imports (after mocks) ─────────────────────────────────────────────────────

import { GmailPoller } from '../channels/gmail.js';
import * as imapSimpleModule from 'imap-simple';
import * as dedupModule from '../channels/dedup.js';
import * as dbModule from '../db/index.js';
import * as storeModule from '../integrations/store.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeImapMessage(uid: number, bodyText: string) {
  return {
    attributes: { uid },
    parts: [
      {
        which: 'HEADER.FIELDS (FROM SUBJECT)',
        body: { from: ['sender@example.com'], subject: ['Test'] },
      },
      { which: 'TEXT', body: bodyText },
    ],
    seqNo: uid,
  };
}

function setupImapConnection(messages: ReturnType<typeof makeImapMessage>[]) {
  (imapSimpleModule.connect as ReturnType<typeof vi.fn>).mockResolvedValue({
    openBox: vi.fn().mockResolvedValue('INBOX'),
    search: vi.fn().mockResolvedValue(messages),
    end: vi.fn(),
  });
}

// ── setup / teardown ──────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-gmail-poller-test-'));
  process.env['KOA_HOME'] = tempDir;
  vi.clearAllMocks();

  // Restore defaults after clearAllMocks wipes all mock implementations
  mockAnthropicCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ type: 'unknown', content: 'x' }) }],
  });

  (imapSimpleModule.connect as ReturnType<typeof vi.fn>).mockResolvedValue({
    openBox: vi.fn().mockResolvedValue('INBOX'),
    search: vi.fn().mockResolvedValue([]),
    end: vi.fn(),
  });

  (dedupModule.isDuplicate as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (dedupModule.contentHash as ReturnType<typeof vi.fn>).mockReturnValue('fake-hash');

  (dbModule.listProjects as ReturnType<typeof vi.fn>).mockReturnValue([
    { id: 'proj-1', name: 'Default Project', slug: 'default-project' },
  ]);

  (storeModule.loadIntegrations as ReturnType<typeof vi.fn>).mockReturnValue([
    {
      id: 'gmail-1',
      type: 'gmail',
      name: 'Gmail',
      status: 'connected',
      config: {
        email: 'user@example.com',
        clientId: 'fake-client-id',
        clientSecret: 'fake-client-secret',
        refreshToken: 'fake-refresh-token',
      },
    },
  ]);
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
  vi.restoreAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────
// _pollOne is private. We exercise it through GmailPoller.start(), which calls
// _pollOne immediately for each connected integration before setting up the
// interval. stop() cancels the interval to prevent further side-effects.

describe('GmailPoller._pollOne (via start)', () => {
  it('skips already-seen UIDs', async () => {
    setupImapConnection([makeImapMessage(42, 'some email body')]);
    (dedupModule.isDuplicate as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const poller = new GmailPoller();
    poller.start('fake-api-key');

    await vi.waitFor(() => expect(imapSimpleModule.connect).toHaveBeenCalled());
    // Allow the async loop body to finish
    await new Promise(r => setTimeout(r, 50));
    poller.stop();

    expect(dedupModule.isDuplicate).toHaveBeenCalledWith('gmail:gmail-1', '42');
    // Duplicate skipped — no task created, no markProcessed
    expect(dedupModule.markProcessed).not.toHaveBeenCalled();
    expect(dbModule.createTask).not.toHaveBeenCalled();
  });

  it('processes a new email and routes it to createTask when intent is task', async () => {
    setupImapConnection([makeImapMessage(99, 'Please add a task: review the PR')]);

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ type: 'task', content: 'Do the thing' }) }],
    });

    const poller = new GmailPoller();
    poller.start('fake-api-key');

    await vi.waitFor(() => expect(dedupModule.markProcessed).toHaveBeenCalled(), { timeout: 3000 });
    poller.stop();

    // Task was created in the default project with the extracted content
    expect(dbModule.createTask).toHaveBeenCalledOnce();
    const [projectId, title, opts] = (dbModule.createTask as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { description: string }];
    expect(projectId).toBe('proj-1');
    expect(title).toBe('Do the thing');
    expect(opts.description).toMatch(/Via Gmail/);

    // UID marked as processed with intent type 'task'
    expect(dedupModule.markProcessed).toHaveBeenCalledWith(
      'gmail:gmail-1',
      '99',
      expect.any(String),
      'task',
    );
  });

  it('deduplicates: same UID returned twice from search is only processed once', async () => {
    const msg = makeImapMessage(7, 'body text');
    setupImapConnection([msg, msg]); // same message object twice

    // First call: not a duplicate. Second call for the same UID: already seen.
    (dedupModule.isDuplicate as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const poller = new GmailPoller();
    poller.start('fake-api-key');

    await vi.waitFor(
      () => expect(dedupModule.isDuplicate).toHaveBeenCalledTimes(2),
      { timeout: 3000 },
    );
    poller.stop();

    // Only the first encounter resulted in processing
    expect(dedupModule.markProcessed).toHaveBeenCalledOnce();
  });

  it('rate limit halts processing after RATE_LIMIT_MAX messages', async () => {
    const messages = Array.from({ length: RATE_LIMIT_MAX + 2 }, (_, i) =>
      makeImapMessage(i + 1, `email body ${i + 1}`),
    );
    setupImapConnection(messages);
    (dedupModule.isDuplicate as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const poller = new GmailPoller();
    poller.start('fake-api-key');

    await vi.waitFor(
      () => expect(dedupModule.markProcessed).toHaveBeenCalledTimes(RATE_LIMIT_MAX),
      { timeout: 5000 },
    );
    // Brief grace period to confirm the extra 2 messages were not processed
    await new Promise(r => setTimeout(r, 50));
    poller.stop();

    expect(dedupModule.markProcessed).toHaveBeenCalledTimes(RATE_LIMIT_MAX);
  });
});

describe('GmailPoller start/stop lifecycle', () => {
  it('does not connect to IMAP when no connected gmail integrations exist', () => {
    (storeModule.loadIntegrations as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const poller = new GmailPoller();
    poller.start('fake-api-key');
    poller.stop();

    expect(imapSimpleModule.connect).not.toHaveBeenCalled();
  });

  it('stop() prevents interval-driven polling', () => {
    vi.useFakeTimers();

    const poller = new GmailPoller();
    poller.start('fake-api-key');
    poller.stop();

    const callsAfterStop = (imapSimpleModule.connect as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(60_000);

    expect((imapSimpleModule.connect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterStop,
    );
    vi.useRealTimers();
  });
});
