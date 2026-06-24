export interface LogEntry {
  ts: number;
  level: 'log' | 'warn' | 'error' | 'debug';
  msg: string;
}

const MAX_ENTRIES = 100;
const _buffer: LogEntry[] = [];
let _installed = false;

export function getLogBuffer(): LogEntry[] { return [..._buffer]; }
export function clearLogBuffer(): void { _buffer.length = 0; }

const SENSITIVE_RE = [
  /Bearer\s+[^\s"]+/gi,
  /refresh_token["']?\s*[=:]\s*["']?[^\s"&,}]+/gi,
  /access_token["']?\s*[=:]\s*["']?[^\s"&,}]+/gi,
  /client_secret["']?\s*[=:]\s*["']?[^\s"&,}]+/gi,
];

export function scrubSensitive(msg: string): string {
  let out = msg;
  for (const re of SENSITIVE_RE) {
    out = out.replace(re, '[redacted]');
  }
  return out;
}

export function installLogCapture(): void {
  if (_installed) return;
  _installed = true;
  const _orig = {
    log:   console.log.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  function capture(level: LogEntry['level'], origFn: (...a: unknown[]) => void, buffer: boolean) {
    return (...args: unknown[]) => {
      origFn(...args);
      if (!buffer) return;
      const msg = scrubSensitive(
        args
          .map(a => (typeof a === 'string' ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a)))
          .join(' ')
      );
      // ts must be current milliseconds since epoch — use whichever method gives that
      _buffer.push({ ts: Date['now'](), level, msg });
      if (_buffer.length > MAX_ENTRIES) _buffer.shift();
    };
  }

  console.log   = capture('log',   _orig.log,   false) as typeof console.log;
  console.warn  = capture('warn',  _orig.warn,  true)  as typeof console.warn;
  console.error = capture('error', _orig.error, true)  as typeof console.error;
  console.debug = capture('debug', _orig.debug, false) as typeof console.debug;
}
