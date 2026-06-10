import { describe, it, expect } from 'vitest';

// Import only the pure validation function — avoids touching the vapid.json store.
const { validatePushEndpoint } = await import('../notifications/webpush.js');

describe('validatePushEndpoint', () => {
  describe('valid origins', () => {
    it('accepts a real FCM endpoint', () => {
      expect(validatePushEndpoint('https://fcm.googleapis.com/send/abc123')).toBe(true);
    });

    it('accepts a Mozilla push endpoint', () => {
      expect(
        validatePushEndpoint('https://updates.push.services.mozilla.com/push/v1/gAA'),
      ).toBe(true);
    });

    it('accepts an Apple push endpoint', () => {
      expect(validatePushEndpoint('https://push.apple.com/3/device/xyz')).toBe(true);
    });

    it('accepts a WNS2 endpoint', () => {
      expect(validatePushEndpoint('https://wns2.windows.com/applications/abc')).toBe(true);
    });

    it('accepts a notify.windows.com endpoint', () => {
      expect(validatePushEndpoint('https://notify.windows.com/push/xyz')).toBe(true);
    });
  });

  describe('lookalike / bypass attempts', () => {
    it('rejects a subdomain lookalike that embeds the allowed host as a suffix', () => {
      // Old prefix match would accept this — exact origin match must reject it.
      expect(validatePushEndpoint('https://fcm.googleapis.com.evil.com/send')).toBe(false);
    });

    it('rejects an unrelated origin that contains the allowed host as a path segment', () => {
      expect(validatePushEndpoint('https://evil.com/fcm.googleapis.com')).toBe(false);
    });

    it('rejects a subdomain of an allowed origin', () => {
      expect(validatePushEndpoint('https://sub.fcm.googleapis.com/push')).toBe(false);
    });
  });

  describe('protocol enforcement', () => {
    it('rejects an http:// endpoint', () => {
      expect(validatePushEndpoint('http://fcm.googleapis.com/send/abc')).toBe(false);
    });
  });

  describe('malformed input', () => {
    it('rejects a non-URL string', () => {
      expect(validatePushEndpoint('not-a-url')).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(validatePushEndpoint('')).toBe(false);
    });
  });
});
