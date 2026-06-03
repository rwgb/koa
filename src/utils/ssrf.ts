// Rejects URLs that could be used for SSRF: non-HTTPS, loopback, private ranges, link-local.
// extraHostCheck enforces a specific hostname allowlist (e.g. Slack webhook domain).
export function validateSafeUrl(raw: string, extraHostCheck?: (h: string) => boolean): void {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (parsed.protocol !== 'https:') throw new Error('URL must use HTTPS');
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    /^127\./.test(host) ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^fc00:/i.test(host) ||
    /^fe80:/i.test(host) ||
    host === '0.0.0.0' ||
    /^\[::ffff:/i.test(host)
  ) { throw new Error('URL resolves to a private or loopback address'); }
  if (extraHostCheck && !extraHostCheck(host)) throw new Error('URL not permitted for this integration type');
}
