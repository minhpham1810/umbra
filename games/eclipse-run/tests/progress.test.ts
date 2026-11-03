import { describe, expect, it } from 'vitest';
import { parseProgress, recordWin } from '../src/progress.js';
describe('campaign progress', () => {
  it('recovers from malformed and untrusted storage', () => {
    expect(parseProgress('{broken').best).toEqual({});
    expect(parseProgress('{"best":{"0":-5,"1":null,"2":42,"99":10}}').best).toEqual({2:42});
  });
  it('unlocks only the next stage and keeps the fastest completion', () => {
    const first = recordWin(parseProgress(null), 0, 1200);
    expect(first.best[0]).toBe(1200);
    expect(first.unlocked).toBe(1);
    expect(recordWin(first, 0, 1500).best[0]).toBe(1200);
    expect(recordWin(first, 0, 900).best[0]).toBe(900);
    expect(recordWin(first, 4, 1000).unlocked).toBe(4);
  });
});
