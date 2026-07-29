<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/relintio-logo-dark.svg">
    <img src="./assets/relintio-logo-light.svg" alt="Relintio" width="260">
  </picture>

  <h1>@relintio/supabase</h1>

  <p>
    <a href="https://jsr.io/@relintio/supabase"><img alt="JSR" src="https://img.shields.io/badge/jsr-@relintio%2Fsupabase-efd420"></a>
    <a href="https://relintio.com/docs/quickstart/supabase"><img alt="quickstart" src="https://img.shields.io/badge/docs-quickstart-efd420"></a>
    <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-efd420"></a>
  </p>

  <p><strong>Relintio for Supabase Edge Functions.</strong></p>
</div>

---

Supabase Edge Functions are Deno: `Deno.serve` takes a handler, hands it a `Request` and expects a `Response`. The entry point here is `withRelintio(handler)`, which returns a handler of exactly that shape and is also the default export. It assesses the request first and answers on its own if the request is refused; otherwise your function runs and its response is returned untouched. Wrapping rather than checking inside the body is the whole point — a function that decides after it has opened a database connection has already paid for the request it was about to refuse. The protocol lives in the engine, [`@relintio/edge-core`](https://www.npmjs.com/package/@relintio/edge-core), shared with the Vercel integration: one passport format, one rule matcher, one set of tests.

```ts
// supabase/functions/orders/index.ts
import { withRelintio } from 'jsr:@relintio/supabase';

Deno.serve(withRelintio(async (request) => {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}));
```

## Installation

There is nothing to install. This package is published to **JSR**, and Deno resolves the `jsr:` specifier itself when the Supabase CLI bundles the function — the import above is the install step. Pin it if you want a version fixed against a deploy:

```ts
import { withRelintio } from 'jsr:@relintio/supabase@1.0.0';
```

`npm install @relintio/supabase` is the wrong instruction and an expensive one, because it succeeds. It leaves a `node_modules` directory the Deno bundler never reads, the function keeps importing whatever the `jsr:` specifier resolves to — or fails to import at all if you also rewrote the specifier — and the shell has already told you it worked.

The licence key belongs in a Supabase secret, not in the function source:

```sh
supabase secrets set RELINTIO_LICENSE_KEY=UP_LIVE_...
supabase functions deploy orders
```

The wrapper reads it through `Deno.env.get`, falling back to `process.env` only so the same wrapper can be exercised under Node in a test. Get the key from **Dashboard → Deployment → Supabase**.

## Registration

Wrap the handler you pass to `Deno.serve`, at module scope, as in the sample. `withRelintio` builds the guard when it is called, and the guard holds the ruleset cache, the fetch timestamp and the single-flight refresh promise as instance state — calling it inside the handler builds a new guard per request, discards all three, and calls `/agent/verify` before every response.

Each Edge Function is its own module and its own isolate. Wrapping one protects that one; a second function deployed beside it is unprotected until it is wrapped too, and it will not appear in the console at all.

If you want the guard without the wrapper — to assess inside a handler that already has its own routing, for instance — `createGuard(options)` returns the `EdgeGuard` itself, and `EdgeGuard` is re-exported for the type. `protect(request, context)` returns a `Response` to send instead of running your code, or `null` to continue. Ignore that return value and you have kept the reporting and lost the enforcement.

Mind the path prefixes. The path the guard sees is the URL path as Supabase routes it, which begins with the function name — a request to the `orders` function arrives as `/orders/...`, so `onlyPaths: ['/admin']` matches nothing and `onlyPaths: ['/orders/admin']` is what you meant.

## Configuration

Passed as the second argument to `withRelintio`, or the first to `createGuard`, and read once when the guard is constructed.

| Option | Default | Meaning |
| --- | --- | --- |
| `licenseKey` | the `RELINTIO_LICENSE_KEY` secret | Required. The `UP_LIVE_…` licence key. **Secret** — see below. |
| `apiUrl` | the `RELINTIO_API_URL` secret, else `https://api.relintio.com/v1` | Control-plane base. Trailing slashes are stripped. |
| `onlyPaths` | `[]`, meaning every path | Prefixes to protect, including the function name segment. |
| `exceptPaths` | `[]` | Prefixes to skip. Checked before `onlyPaths` and wins over it. A skipped path does not even fetch a policy. |
| `rulesTtlSeconds` | `60` | How long a fetched ruleset is trusted. `0` attempts a refresh on every request, still single-flight. A negative or non-numeric value falls back to 60 rather than to zero. |

`agentKind` is fixed to `supabase` and is not an option; it is what tells the dashboard which integration reported a decision.

The licence key is a **secret**. It is the HMAC key that mints challenge passports and signs every outbound call, so anyone holding it can forge both and walk through the WAF. A key in the function source is a key in the repository. It must never reach a browser either — browsers take a publishable key (`pk_live_…`), which can do exactly one thing, ask for a verdict, and belongs to the React and Shopify SDKs rather than to anything running here.

The guard checks which one it was handed, because this runs on a server and needs the signing key. A key that is empty or begins `pk_` sets `isUsable()` to `false`, writes one `console.error` naming the two key types, and turns every assessment into a pass-through without transmitting anything. `test/handler.test.mjs` asserts both halves of that: a licence key from a Deno secret is usable, a publishable key is not.

## What a refused request gets

The function body never runs. `protect` returns a `Response`, the wrapper returns it, and `Deno.serve` sends it — no database connection is opened, no service-role query is issued, and nothing your handler would have read is read. That is the difference from checking inside the body, and `test/handler.test.mjs` proves it by asserting the handler never sets its flag on a blocked request.

| Verdict | What the caller receives |
| --- | --- |
| Block | `403` with a self-contained `text/html` page, `Cache-Control: no-store` |
| Challenge | `302` to the hosted challenge, with the full request URL as `return_url`, `Cache-Control: no-store` |
| Valid `?up_token` | `302` back to the same URL with only `up_token` stripped, setting the `relintio_passport` cookie `Path=/; Max-Age=<ttl>; HttpOnly; SameSite=Lax`, plus `Secure` over HTTPS |
| Invalid `?up_token` | `403 Invalid Token` — the only way to hold a valid one is to have just passed the challenge |
| Allow | Nothing; your handler runs and its response is returned as it is |

An allowed request costs one `startsWith` per configured prefix, a cookie check, and — when the cached ruleset is still inside its TTL — no network call at all.

## Identifying the visitor

`Deno.serve` passes connection info as the handler's second argument, and behind Supabase's own proxy that address is the proxy. Blocking on it bans every visitor behind it, so the wrapper takes the first hop of `x-forwarded-for` and uses `info.remoteAddr.hostname` only as a fallback. The second argument is passed through to your handler unchanged, which the tests pin, so anything you were already doing with it still works.

## Edge cases

**A blocked API client gets an HTML page, and a challenged one gets a redirect it cannot solve.** Edge Functions are usually JSON endpoints, but the block page is a fixed English HTML document and the challenge is a `302` to a browser flow. A `fetch` from your own front end sees a `403` with an unparseable body; a mobile client or a server-to-server caller sees the same. If that matters, match on the status upstream rather than on the body, and consider `exceptPaths` for machine-only routes.

**The refusal responses carry no CORS headers.** A block sets `Content-Type` and `Cache-Control`; a challenge sets `Location` and `Cache-Control`. Neither carries the `Access-Control-Allow-Origin` your function returns, so a browser calling a blocked function cross-origin reports a CORS failure rather than a `403`. Preflight `OPTIONS` requests are assessed like any other request, so a rule matching on address or header will refuse one.

**Deno has no `waitUntil`, so reports race the isolate.** `Deno.serve` keeps the process alive between requests, so a report usually lands, but a function about to be evicted may lose one. Losing a sampled allow is noise. Losing a block would be evidence, which is why blocks and challenges are never sampled and why the platform treats a missing report as missing rather than as an allow. The report is never awaited on the request path in any case.

**Roughly one allowed request in a hundred is reported.** Allows are sampled at a fixed 1% and the platform multiplies them back up; the rate is deliberately not an option, because an install sampling differently would report a number the platform then corrects with the wrong constant.

**The first request through a cold isolate waits for the policy.** A fresh isolate has no ruleset, so that request awaits `/agent/verify` with a 3000 ms abort. It is enforced against whatever arrives, and allowed if nothing does. A burst against a cold isolate collapses into one call rather than one per request, but that one request pays the round trip. Everything cached is per isolate, so a rule changed in the dashboard takes effect within `rulesTtlSeconds` in each isolate independently.

**A challenge the licence cannot present is an allow, not a block.** When the fetched settings carry `challenge_enabled: false` the request goes through and is recorded as an allow with the reason `Challenge unavailable`. The score is still evidence; refusing traffic over a feature the customer turned off is not what they asked for.

**`x-forwarded-for` is set by whatever is in front of the function.** It is read with no notion of a trusted hop, and the same value is what `whitelist_ips` is compared against by exact string match. Supabase overwrites it at its own edge, which is what makes it usable — anything you put in front of that changes the answer.

**Every failure releases the request.** An unreachable control plane, a non-2xx answer, an unparseable body, a `200` carrying no `rules` array, or any exception anywhere inside the guard: your function serves. A cached ruleset survives all of them and is never replaced by a failure — an explicitly empty `rules` array is a policy and is applied, but an error envelope is not. A security agent that takes a function down because it could not reach its control plane has turned our outage into the customer's.

## Links

- [Documentation](https://relintio.com/docs)
- [Quickstart](https://relintio.com/docs/quickstart/supabase)
- [API reference](https://relintio.com/docs/api-reference)
- [Licenses](https://relintio.com/licenses)

Security reports go to **support@relintio.com**, not to a public issue.

## License

MIT, as declared in [`jsr.json`](./jsr.json), [`package.json`](./package.json) and [`LICENSE`](./LICENSE).

This wrapper is MIT and `@relintio/edge-core`, the engine it is built on, is not. That is deliberate rather than an oversight. JSR requires every package to carry a valid SPDX licence identifier and the Relintio Proprietary License has none, so a proprietary package cannot be published there at all — and `jsr:@relintio/supabase` is the specifier a Deno runtime resolves natively. What is MIT here is the adapter: the code that hands a `Request` to the engine and returns what it decides. The engine stays proprietary, on npm, where it is resolved as an `npm:` dependency.
