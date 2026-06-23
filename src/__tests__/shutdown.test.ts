import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerGracefulShutdown } from '../server/shutdown.js';

describe('registerGracefulShutdown', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock process.exit so tests don't actually terminate the process
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    // Remove any lingering signal listeners added during the test
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('calls the cleanup callback when SIGTERM is received', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);

    registerGracefulShutdown(cleanup);
    process.emit('SIGTERM');

    // Allow async handler to settle
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it('calls process.exit(0) after the cleanup callback resolves on SIGTERM', async () => {
    const order: string[] = [];
    const cleanup = vi.fn().mockImplementation(async () => {
      order.push('cleanup');
    });
    exitSpy.mockImplementation((() => { order.push('exit'); }) as never);

    registerGracefulShutdown(cleanup);
    process.emit('SIGTERM');

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledOnce());

    expect(order).toEqual(['cleanup', 'exit']);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('calls the cleanup callback when SIGINT is received', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);

    registerGracefulShutdown(cleanup);
    process.emit('SIGINT');

    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it('calls process.exit(0) after the cleanup callback resolves on SIGINT', async () => {
    const order: string[] = [];
    const cleanup = vi.fn().mockImplementation(async () => {
      order.push('cleanup');
    });
    exitSpy.mockImplementation((() => { order.push('exit'); }) as never);

    registerGracefulShutdown(cleanup);
    process.emit('SIGINT');

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledOnce());

    expect(order).toEqual(['cleanup', 'exit']);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('still calls process.exit(0) even when the cleanup callback throws', async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error('cleanup failure'));

    registerGracefulShutdown(cleanup);
    process.emit('SIGTERM');

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledOnce());

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('only fires once per signal (process.once semantics)', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);

    registerGracefulShutdown(cleanup);
    process.emit('SIGTERM');
    process.emit('SIGTERM'); // second emit — listener should already be gone

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
