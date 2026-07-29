import { EdgeGuard } from '@relintio/edge-core';

export const INTEGRATION_VERSION = '1.0.0';

/**
 * Relintio for Supabase Edge Functions.
 *
 * Supabase Edge Functions are Deno: `Deno.serve` takes a handler, hands it a
 * `Request` and expects a `Response`. That is the same Web-standard shape the
 * Vercel integration wraps, so both run `@relintio/edge-core` — one protocol,
 * one passport format, one set of tests.
 *
 * ```ts
 * import { withRelintio } from 'jsr:@relintio/supabase';
 *
 * Deno.serve(withRelintio(async (request) => {
 *   return new Response('hello');
 * }));
 * ```
 *
 * The licence key belongs in a Supabase secret, not in the function source:
 *
 * ```bash
 * supabase secrets set RELINTIO_LICENSE_KEY=UP_LIVE_...
 * ```
 */
export function createGuard(options = {}) {
  return new EdgeGuard({
    licenseKey: options.licenseKey || readEnv('RELINTIO_LICENSE_KEY'),
    apiUrl: options.apiUrl || readEnv('RELINTIO_API_URL') || undefined,
    onlyPaths: options.onlyPaths,
    exceptPaths: options.exceptPaths,
    rulesTtlSeconds: options.rulesTtlSeconds,
    agentKind: 'supabase',
  });
}

/**
 * Wrap a Deno handler.
 *
 * Relintio assesses first and answers on its own if the request is refused;
 * otherwise your handler runs and its response is returned untouched.
 *
 * @param {(request: Request, info?: object) => Response|Promise<Response>} handler
 * @param {object} [options]
 */
export function withRelintio(handler, options = {}) {
  const guard = createGuard(options);

  return async function relintioHandler(request, info) {
    const refused = await guard.protect(request, {
      // Deno has no `waitUntil`. A report is therefore raced against the
      // isolate: `Deno.serve` keeps the process alive between requests, so it
      // usually lands, but a function that is about to be evicted may lose
      // one. Losing a sampled ALLOW is noise; losing a BLOCK would be
      // evidence, which is why blocks are never sampled and why the platform
      // treats a missing report as missing rather than as an allow.
      ip: extractIp(request, info),
    });

    if (refused) {
      return refused;
    }

    return handler(request, info);
  };
}

export { EdgeGuard };
export default withRelintio;

function extractIp(request, info) {
  const forwarded = request.headers.get('x-forwarded-for');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // `Deno.serve` passes the connection info as the second argument. Behind
  // Supabase's own proxy this is the proxy, so it is the fallback rather than
  // the first choice.
  return info?.remoteAddr?.hostname || '';
}

function readEnv(name) {
  // Deno first, because that is where this runs. `process.env` is the fallback
  // for anyone running the same wrapper under Node in a test.
  if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
    return Deno.env.get(name) || '';
  }

  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] || '';
  }

  return '';
}
