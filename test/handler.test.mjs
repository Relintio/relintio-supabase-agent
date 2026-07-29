/**
 * What the Supabase wrapper adds over the shared edge engine.
 *
 * The engine's behaviour is tested in `agents/edge`. These cover the Deno
 * shape: the handler is wrapped rather than mounted, the visitor's address
 * comes from the forwarding header rather than from Supabase's own proxy, and
 * a refused request never reaches the function body.
 *
 * Run: node --test test/handler.test.mjs
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const { withRelintio, createGuard } = await import('../src/index.js');

const LICENSE = 'UP_LIVE_' + 'a'.repeat(32);
const API = 'https://api.relintio.test/v1';
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.Deno;
});

const blockRule = {
  type: 'ip',
  pattern: '203.0.113.10',
  condition: 'equals',
  action: 'block',
  score: 100,
};

function stubPlatform(rules) {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/agent/verify')) {
      return new Response(JSON.stringify({ rules }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('{}', { status: 200 });
  };
}

function request(headers = {}) {
  return new Request('https://project.functions.supabase.co/orders', {
    headers: { 'user-agent': 'Mozilla/5.0', ...headers },
  });
}

describe('the wrapped handler', () => {
  it('never reaches the function body on a blocked request', async () => {
    // The reason to wrap rather than to check inside: a Supabase function that
    // decides after it has already opened a database connection has paid for
    // the request it was about to refuse.
    stubPlatform([blockRule]);

    let ran = false;
    const served = withRelintio(
      async () => {
        ran = true;

        return new Response('rows');
      },
      { licenseKey: LICENSE, apiUrl: API },
    );

    const response = await served(request({ 'x-forwarded-for': '203.0.113.10' }));

    assert.equal(response.status, 403);
    assert.equal(ran, false);
  });

  it('returns the function’s own response when the request is allowed', async () => {
    stubPlatform([blockRule]);

    const served = withRelintio(
      async () => new Response('rows', { status: 200 }),
      { licenseKey: LICENSE, apiUrl: API },
    );

    const response = await served(request({ 'x-forwarded-for': '198.51.100.4' }));

    assert.equal(await response.text(), 'rows');
  });

  it('passes Deno’s connection info through to the handler', async () => {
    stubPlatform([]);

    let seen = null;
    const served = withRelintio(
      async (_request, info) => {
        seen = info;

        return new Response('ok');
      },
      { licenseKey: LICENSE, apiUrl: API },
    );

    const info = { remoteAddr: { hostname: '10.0.0.4' } };
    await served(request(), info);

    assert.equal(seen, info);
  });

  it('identifies the visitor by the forwarding header, not by Supabase’s proxy', async () => {
    // `Deno.serve`'s connection info is the address of whatever connected,
    // which behind Supabase's own proxy is the proxy. Blocking on that bans
    // every visitor behind it.
    stubPlatform([blockRule]);

    const served = withRelintio(async () => new Response('rows'), {
      licenseKey: LICENSE,
      apiUrl: API,
    });

    const response = await served(
      request({ 'x-forwarded-for': '203.0.113.10, 10.0.0.4' }),
      { remoteAddr: { hostname: '10.0.0.4' } },
    );

    assert.equal(response.status, 403, 'the first hop is the visitor');
  });
});

describe('configuration', () => {
  it('reads the licence key from a Deno secret', () => {
    // `supabase secrets set RELINTIO_LICENSE_KEY=…` is where this belongs; a
    // key in the function source is a key in the repository.
    globalThis.Deno = {
      env: { get: (name) => (name === 'RELINTIO_LICENSE_KEY' ? LICENSE : '') },
    };

    assert.equal(createGuard().isUsable(), true);
  });

  it('refuses to start on a publishable key', () => {
    const realError = console.error;
    console.error = () => {};

    try {
      assert.equal(createGuard({ licenseKey: 'pk_live_' + 'b'.repeat(40) }).isUsable(), false);
    } finally {
      console.error = realError;
    }
  });
});
