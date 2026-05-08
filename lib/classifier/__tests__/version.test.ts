import { describe, it, expect } from 'vitest';
import { getDeterministicVersion, getLlmVersion } from '../version';

describe('classifier versioning', () => {
  it('getDeterministicVersion returns a 12-char hex string', () => {
    const v = getDeterministicVersion();
    expect(v).toMatch(/^[a-f0-9]{12}$/);
  });

  it('getLlmVersion returns a 12-char hex string', () => {
    const v = getLlmVersion();
    expect(v).toMatch(/^[a-f0-9]{12}$/);
  });

  it('deterministic and LLM versions differ', () => {
    expect(getDeterministicVersion()).not.toBe(getLlmVersion());
  });

  it('versions are stable across calls', () => {
    expect(getDeterministicVersion()).toBe(getDeterministicVersion());
    expect(getLlmVersion()).toBe(getLlmVersion());
  });
});
