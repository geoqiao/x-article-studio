import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import redirect from '../worker/www-redirect';

const telemetry = readFileSync(new URL('../public/telemetry.js', import.meta.url), 'utf8');

function browser(origin = 'https://md2xarticle.com', navigator = {}, window = {}) {
  const stored = new Map<string, string>();
  const fetch = vi.fn().mockResolvedValue({ type: 'opaque' });
  const context = {
    location: { origin }, navigator, window, fetch,
    crypto: { randomUUID: () => 'test-visitor-id' },
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
    // Article content is deliberately present but must never enter the event.
    document: { title: 'Private article', body: { textContent: 'Private Markdown' } },
  };
  return { context, stored, fetch, run: () => runInNewContext(telemetry, context) };
}

describe('website privacy boundaries', () => {
  it.each(['http://127.0.0.1:4318', 'https://preview.example.com', 'https://www.md2xarticle.com'])('does not track %s', origin => {
    const b = browser(origin);
    b.run();
    expect(b.fetch).not.toHaveBeenCalled();
    expect(b.stored.size).toBe(0);
  });

  it.each([
    [{ doNotTrack: '1' }, {}],
    [{ globalPrivacyControl: true }, {}],
    [{}, { doNotTrack: '1' }],
  ])('honors browser privacy preferences before storage or network', (navigator, window) => {
    const b = browser(undefined, navigator, window);
    b.run();
    expect(b.fetch).not.toHaveBeenCalled();
    expect(b.stored.size).toBe(0);
  });

  it('sends only the existing visit payload once, without cookies or referrer', () => {
    const b = browser();
    b.stored.set('vc:telemetry:visitor:cmu4b884000000agmn23vud8y', 'existing-visitor');
    b.run();
    b.run();
    expect(b.fetch).toHaveBeenCalledTimes(1);
    const [endpoint, request] = b.fetch.mock.calls[0];
    expect(endpoint).toBe('https://vibecafe.ai/api/products/cmu4b884000000agmn23vud8y/telemetry/events');
    expect(request).toMatchObject({ method: 'POST', mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true });
    const payload = JSON.parse(request.body);
    expect(Object.keys(payload).sort()).toEqual(['event', 'key', 'visitorId']);
    expect(payload).toMatchObject({ event: 'pageview', visitorId: 'existing-visitor' });
  });

  it('tolerates unavailable storage and a failed event without retrying', async () => {
    const b = browser();
    b.context.localStorage.getItem = () => { throw new Error('Storage blocked'); };
    b.fetch.mockRejectedValue(new Error('Offline'));
    expect(b.run).not.toThrow();
    await Promise.resolve();
    expect(b.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('www canonical redirect', () => {
  it.each([
    ['http://www.md2xarticle.com/', 'https://md2xarticle.com/'],
    ['https://www.md2xarticle.com/support?utm_source=test&next=https%3A%2F%2Fexample.com', 'https://md2xarticle.com/support?utm_source=test&next=https%3A%2F%2Fexample.com'],
    ['https://www.md2xarticle.com:8443/a%20b?q=a%2Bb', 'https://md2xarticle.com/a%20b?q=a%2Bb'],
    ['https://www.md2xarticle.com//example.com/path', 'https://md2xarticle.com//example.com/path'],
  ])('preserves the path and query with a fixed HTTPS destination', (source, destination) => {
    const response = redirect.fetch(new Request(source));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(destination);
  });
});
