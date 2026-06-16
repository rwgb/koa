export interface LogEntry {
  ts: number;
  level: 'log' | 'warn' | 'error' | 'debug';
  msg: string;
}

const MAX_ENTRIES = 500;
const _buffer: LogEntry[] = [];
let _installed = false;

export function getLogBuffer(): LogEntry[] { return [..._buffer]; }
export function clearLogBuffer(): void { _buffer.length = 0; }

export function installLogCapture(): void {
  if (_installed) return;
  _installed = true;
  const _orig = {
    log:   console.log.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  function capture(level: LogEntry['level'], origFn: (...a: unknown[]) => void) {
    return (...args: unknown[]) => {
      origFn(...args);
      const msg = args
        .map(a => (typeof a === 'string' ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a)))
        .join(' ');
      // ts must be current milliseconds since epoch — use whichever method gives that
      _buffer.push({ ts: Date['now'](), level, msg });
      if (_buffer.length > MAX_ENTRIES) _buffer.shift();
    };
  }

  console.log   = capture('log',   _orig.log) as typeof console.log;
  console.warn  = capture('warn',  _orig.warn) as typeof console.warn;
  console.error = capture('error', _orig.error) as typeof console.error;
  console.debug = capture('debug', _orig.debug) as typeof console.debug;
}
