/**
 * Unit tests for pure helper functions used in App.tsx.
 * These are tested in isolation without mounting React components.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── relativeTime ─────────────────────────────────────────────────────────────
// Mirrors the implementation in App.tsx
function relativeTime(isoTimestamp: string): string {
  const diff = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── isValid (Maps API key guard) ─────────────────────────────────────────────
// Mirrors the implementation in App.tsx
function isValid(k: unknown): k is string {
  return (
    typeof k === 'string' &&
    k.trim().length > 10 &&
    !k.startsWith('your_') &&
    k !== 'API_KEY_REQUIRED' &&
    !k.includes('placeholder')
  );
}

// ── relativeTime tests ────────────────────────────────────────────────────────
describe('relativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns seconds ago for timestamps under 60s', () => {
    const now = new Date('2024-01-01T12:00:30Z');
    vi.setSystemTime(now);
    const ts = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(relativeTime(ts)).toBe('30s ago');
  });

  it('returns minutes ago for timestamps between 1-59 minutes', () => {
    const now = new Date('2024-01-01T12:15:00Z');
    vi.setSystemTime(now);
    const ts = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(relativeTime(ts)).toBe('15m ago');
  });

  it('returns hours ago for timestamps over 1 hour', () => {
    const now = new Date('2024-01-01T15:00:00Z');
    vi.setSystemTime(now);
    const ts = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(relativeTime(ts)).toBe('3h ago');
  });

  it('returns 0s ago for a just-created timestamp', () => {
    const now = new Date('2024-01-01T12:00:00Z');
    vi.setSystemTime(now);
    expect(relativeTime(now.toISOString())).toBe('0s ago');
  });

  it('floors partial minutes', () => {
    const now = new Date('2024-01-01T12:01:45Z');
    vi.setSystemTime(now);
    const ts = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(relativeTime(ts)).toBe('1m ago');
  });
});

// ── isValid tests ─────────────────────────────────────────────────────────────
describe('isValid (Maps API key guard)', () => {
  it('accepts a realistic-looking API key', () => {
    expect(isValid('AIzaSyABCDEFGHIJKLMNOPQRSTUV')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValid('')).toBe(false);
  });

  it('rejects short strings (≤10 chars)', () => {
    expect(isValid('short')).toBe(false);
    expect(isValid('1234567890')).toBe(false);
  });

  it('rejects the literal placeholder value API_KEY_REQUIRED', () => {
    expect(isValid('API_KEY_REQUIRED')).toBe(false);
  });

  it('rejects keys starting with your_', () => {
    expect(isValid('your_maps_api_key_here')).toBe(false);
  });

  it('rejects keys containing the word placeholder', () => {
    expect(isValid('put_your_placeholder_here_12345')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValid(null)).toBe(false);
    expect(isValid(undefined)).toBe(false);
    expect(isValid(42)).toBe(false);
    expect(isValid({})).toBe(false);
  });

  it('rejects keys that are only whitespace', () => {
    expect(isValid('           ')).toBe(false);
  });
});
