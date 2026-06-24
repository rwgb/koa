// Rejects URLs that could be used for SSRF: non-HTTPS, loopback, private ranges, link-local.
// extraHostCheck enforces a specific hostname allowlist (e.g. Slack webhook domain).
export function validateSafeUrl(raw: string, extraHostCheck?: (h: string) => boolean): void {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (parsed.protocol !== 'https:') throw new Error('URL must use HTTPS');
  const host = parsed.hostname.toLowerCase();
  // Node.js wraps IPv6 addresses in brackets in hostname (e.g. [::1]); strip them for comparisons.
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (
    host === 'localhost' ||
    /^127\./.test(host) ||
    bareHost === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(bareHost) ||
    /^fe80:/i.test(bareHost) ||
    host === '0.0.0.0' ||
    /^::ffff:/i.test(bareHost) ||
    // RFC 6598 shared address space (100.64.0.0/10) — used by Tailscale CGNAT; block to prevent SSRF into overlay network
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
  ) { throw new Error('URL resolves to a private or loopback address'); }
  if (extraHostCheck && !extraHostCheck(host)) throw new Error('URL not permitted for this integration type');
}
