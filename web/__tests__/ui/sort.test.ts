import { describe, expect, it } from 'vitest';
import { sortAlpha } from '@/ui/sort';

describe('sortAlpha', () => {
  it('sorts by label ignoring case and accents', () => {
    const items = ['banana', 'Apple', 'élan', 'cherry'];
    expect(sortAlpha(items, (s) => s)).toEqual(['Apple', 'banana', 'cherry', 'élan']);
  });

  it('orders embedded numbers numerically', () => {
    const items = ['page 10', 'page 2', 'page 1'];
    expect(sortAlpha(items, (s) => s)).toEqual(['page 1', 'page 2', 'page 10']);
  });

  it('does not mutate the input', () => {
    const items = ['b', 'a'];
    sortAlpha(items, (s) => s);
    expect(items).toEqual(['b', 'a']);
  });
});
