import { describe, it, expect } from 'vitest';
import { isDue } from '../proactive/delegations.js';

describe('isDue', () => {
  const now = new Date('2026-06-03T08:00:00Z');

  it('is due when never run', () => {
    expect(isDue({ schedule: 'daily', last_run: null, enabled: 1 }, now)).toBe(true);
  });

  it('is not due when disabled', () => {
    expect(isDue({ schedule: 'daily', last_run: null, enabled: 0 }, now)).toBe(false);
  });

  it('is due after daily interval', () => {
    const lastRun = new Date(now.getTime() - 25 * 3_600_000).toISOString();
    expect(isDue({ schedule: 'daily', last_run: lastRun, enabled: 1 }, now)).toBe(true);
  });

  it('is not due before daily interval', () => {
    const lastRun = new Date(now.getTime() - 23 * 3_600_000).toISOString();
    expect(isDue({ schedule: 'daily', last_run: lastRun, enabled: 1 }, now)).toBe(false);
  });

  it('is due after weekly interval', () => {
    const lastRun = new Date(now.getTime() - 8 * 86_400_000).toISOString();
    expect(isDue({ schedule: 'weekly', last_run: lastRun, enabled: 1 }, now)).toBe(true);
  });

  it('handles day-of-week schedule as weekly', () => {
    const lastRun = new Date(now.getTime() - 8 * 86_400_000).toISOString();
    expect(isDue({ schedule: 'monday', last_run: lastRun, enabled: 1 }, now)).toBe(true);
  });
});
