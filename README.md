# @relintio/supabase

Runtime application security for Supabase Edge Functions, from
[Relintio](https://relintio.com).

```ts
// supabase/functions/orders/index.ts
import { withRelintio } from 'jsr:@relintio/supabase';

Deno.serve(withRelintio(async (request) => {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}));
```

```bash
supabase secrets set RELINTIO_LICENSE_KEY=UP_LIVE_...
```

Get the key from **Dashboard → Deployment → Supabase**.

## Why wrap rather than check inside

A function that decides after it has already opened a database connection has
paid for the request it was about to refuse. Wrapping means a blocked request
never reaches the function body at all.

## The key

A licence key (`UP_LIVE_…`), in a Supabase secret. A key in the function source
is a key in the repository.

The wrapper refuses to start on a publishable key and says why: a publishable
key cannot sign a challenge passport, so every visitor would be challenged
again on every request with nothing in any log explaining it.

## Identifying the visitor

`Deno.serve` passes connection info as the handler's second argument, but
behind Supabase's own proxy that address is the proxy — blocking on it bans
every visitor behind it. The visitor is taken from the first hop of
`x-forwarded-for`, and the connection info is the fallback.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `licenseKey` | `RELINTIO_LICENSE_KEY` secret | `UP_LIVE_…`. |
| `apiUrl` | `RELINTIO_API_URL`, else `https://api.relintio.com/v1` | Override for staging. |
| `onlyPaths` | all paths | Protect only these prefixes. |
| `exceptPaths` | none | Skip these prefixes. |
| `rulesTtlSeconds` | `60` | How long a fetched ruleset is trusted. |

## A note on telemetry

Deno has no `waitUntil`. `Deno.serve` keeps the isolate alive between requests,
so a report usually lands, but a function about to be evicted may lose one.
Losing a sampled allow is noise; blocks and challenges are never sampled, and
the platform treats a missing report as missing rather than as an allow.

## Failing open

Every path. If Relintio cannot be reached, your function serves.

## Licence

See [LICENSE](LICENSE). Same terms as `@relintio/agent`.
