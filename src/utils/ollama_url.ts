const OLLAMA_URL_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/;

// Ollama is always an internal service; allow loopback + RFC1918 private ranges.
export function isOllamaUrl(url: string): boolean {
  return OLLAMA_URL_RE.test(url);
}
