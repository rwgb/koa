import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnScheduler } from '../agent/scheduler.js';

// Small helper: returns a promise that resolves after `ms` milliseconds.
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('TurnScheduler', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('two high-priority turns: second starts only after first resolves', async () => {
    const order: string[] = [];

    const runTurn = vi.fn().mockImplementation(async (msg: string) => {
      order.push(`start:${msg}`);
      await delay(10);
      order.push(`end:${msg}`);
      return msg;
    });

    const scheduler = new TurnScheduler(runTurn);

    const p1 = scheduler.enqueue('first', 'high');
    const p2 = scheduler.enqueue('second', 'high');

    await Promise.all([p1, p2]);

    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('low-priority turn waits for an active high-priority turn to complete', async () => {
    const order: string[] = [];

    const runTurn = vi.fn().mockImplementation(async (msg: string) => {
      order.push(`start:${msg}`);
      await delay(10);
      order.push(`end:${msg}`);
      return msg;
    });

    const scheduler = new TurnScheduler(runTurn);

    const high = scheduler.enqueue('high-turn', 'high');
    const low = scheduler.enqueue('low-turn', 'low');

    await Promise.all([high, low]);

    // high must fully complete before low starts
    expect(order.indexOf('end:high-turn')).toBeLessThan(order.indexOf('start:low-turn'));
  });

  it('enqueue() while draining rejects with the drain error', async () => {
    const runTurn = vi.fn().mockResolvedValue('done');
    const scheduler = new TurnScheduler(runTurn);

    void scheduler.drain();

    await expect(scheduler.enqueue('msg', 'high')).rejects.toThrow(
      'Agent is draining — not accepting new turns',
    );
  });

  it('drain() resolves after the current running turn finishes', async () => {
    let resolveRun!: () => void;
    const runTurn = vi.fn().mockImplementation(
      () => new Promise<string>(r => { resolveRun = () => r('done'); }),
    );

    const scheduler = new TurnScheduler(runTurn);

    // Start a turn — it will block until we call resolveRun
    const turnPromise = scheduler.enqueue('msg', 'high');

    // Kick off drain — should not resolve yet
    let drained = false;
    const drainPromise = scheduler.drain().then(() => { drained = true; });

    // Confirm drain hasn't resolved while the turn is still running
    await delay(20);
    expect(drained).toBe(false);

    // Unblock the running turn
    resolveRun();
    await turnPromise;
    await drainPromise;

    expect(drained).toBe(true);
  });

  it('isBusy() returns true while running, false otherwise', async () => {
    let resolveRun!: () => void;
    const runTurn = vi.fn().mockImplementation(
      () => new Promise<string>(r => { resolveRun = () => r('done'); }),
    );

    const scheduler = new TurnScheduler(runTurn);

    expect(scheduler.isBusy()).toBe(false);

    const turnPromise = scheduler.enqueue('msg', 'high');

    // Wait one microtask tick for _processNext to fire
    await Promise.resolve();

    expect(scheduler.isBusy()).toBe(true);

    resolveRun();
    await turnPromise;

    // Allow the finally() in _processNext to run
    await Promise.resolve();

    expect(scheduler.isBusy()).toBe(false);
  });
});
