import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockSend = vi.fn();
const mockGetMessage = vi.fn();
const mockGetAccessToken = vi.fn().mockResolvedValue({ token: 'fake-access-token' });

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
}));

vi.mock('googleapis', () => {
  const OAuth2 = vi.fn(function (this: Record<string, unknown>) {
    this['setCredentials'] = vi.fn();
    this['getAccessToken'] = mockGetAccessToken;
  });

  return {
    google: {
      auth: { OAuth2 },
      gmail: vi.fn(() => ({
        users: {
          messages: {
            send: mockSend,
            get: mockGetMessage,
          },
        },
      })),
    },
  };
});

import { sendEmail, isValidEmail } from '../channels/gmail-send.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function decodeBase64url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAccessToken.mockResolvedValue({ token: 'fake-access-token' });
  mockSend.mockResolvedValue({
    data: {
      id: 'msg-001',
      payload: {
        headers: [{ name: 'Message-ID', value: '<abc@mail.gmail.com>' }],
      },
    },
  });
  mockGetMessage.mockResolvedValue({
    data: {
      threadId: 'thread-123',
      payload: {
        headers: [{ name: 'Message-ID', value: '<parent@mail.gmail.com>' }],
      },
    },
  });
});

describe('sendEmail', () => {
  it('sends a correctly encoded RFC 2822 message', async () => {
    const messageId = await sendEmail({
      to: 'recipient@example.com',
      subject: 'Hello World',
      body: 'This is the email body.',
    });

    expect(messageId).toBe('<abc@mail.gmail.com>');
    expect(mockSend).toHaveBeenCalledOnce();

    const rawCall = mockSend.mock.calls[0];
    if (!rawCall) throw new Error('mockSend not called');
    const call = rawCall[0] as { userId: string; requestBody: { raw: string } };
    expect(call.userId).toBe('me');

    const decoded = decodeBase64url(call.requestBody.raw);
    expect(decoded).toContain('To: recipient@example.com');
    expect(decoded).toContain('Subject: Hello World');
    expect(decoded).toContain('Content-Type: text/plain; charset=utf-8');
    expect(decoded).toContain('This is the email body.');
  });

  it('adds In-Reply-To and References headers when replyToMessageId is set', async () => {
    await sendEmail({
      to: 'recipient@example.com',
      subject: 'Re: Hello',
      body: 'Reply body.',
      replyToMessageId: 'msg-parent-id',
    });

    const rawReplyCall = mockSend.mock.calls[0];
    if (!rawReplyCall) throw new Error('mockSend not called');
    const call = rawReplyCall[0] as { requestBody: { raw: string; threadId?: string } };
    const decoded = decodeBase64url(call.requestBody.raw);
    expect(decoded).toContain('In-Reply-To: <parent@mail.gmail.com>');
    expect(decoded).toContain('References: <parent@mail.gmail.com>');
    expect(call.requestBody.threadId).toBe('thread-123');
  });

  it('throws an error for an invalid email address', async () => {
    await expect(
      sendEmail({ to: 'not-an-email', subject: 'Test', body: 'body' }),
    ).rejects.toThrow('Invalid email address');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('isValidEmail', () => {
  it('returns true for valid email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('foo.bar+baz@sub.domain.org')).toBe(true);
  });

  it('returns false for invalid email addresses', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@domain.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
  });
});
