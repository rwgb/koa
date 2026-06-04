export function registerGracefulShutdown(cleanup: () => void | Promise<void>): void {
  const handler = async (signal: string) => {
    process.stderr.write(`[koa] received ${signal}, shutting down\n`);
    try { await cleanup(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.once('SIGTERM', () => handler('SIGTERM'));
  process.once('SIGINT', () => handler('SIGINT'));
}
