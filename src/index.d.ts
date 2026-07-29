/**
 * Type declarations for `@relintio/supabase`.
 *
 * These exist because JSR type-checks a published module without running type
 * inference — "fast check" — and a JavaScript entrypoint with no declarations
 * cannot be checked that way. Publishing anyway costs the whole "no slow types"
 * portion of the package score and, more concretely, means Deno and Node
 * consumers get no types at all from an install.
 *
 * `EdgeGuard` is declared here rather than imported from
 * `@relintio/edge-core`, which ships no declarations of its own. What is
 * declared is the part of it this integration's contract depends on; the
 * authoritative implementation is in that package, and
 * `SdkReleasePipelineTest` fails if the two disagree about what is exported.
 */

/** Options accepted by both `createGuard` and `withRelintio`. */
export interface RelintioOptions {
  /**
   * The licence key (`UP_LIVE_…`). Read from the `RELINTIO_LICENSE_KEY`
   * environment variable when omitted, which is where it belongs — set it with
   * `supabase secrets set`, never in the function source.
   */
  licenseKey?: string;

  /** Control-plane base URL. Defaults to the production API. */
  apiUrl?: string;

  /**
   * Assess only these path prefixes. A pattern ending in `*` is a prefix; every
   * other pattern is an exact match. Remember that a Supabase function path
   * includes the function name segment.
   */
  onlyPaths?: string[];

  /** Assess everything except these path prefixes, with the same matching. */
  exceptPaths?: string[];

  /** How long a fetched ruleset is reused before the next request refreshes it. */
  rulesTtlSeconds?: number;
}

/**
 * The shared edge engine, re-exported for callers that want to assess a request
 * without wrapping a handler.
 *
 * Only the member this integration relies on is declared. `@relintio/edge-core`
 * owns the rest.
 */
export declare class EdgeGuard {
  constructor(options: RelintioOptions & { agentKind?: string });

  /**
   * Assess one request. Resolves to a `Response` to send **instead of** running
   * the application, or `null` to let the request through. It never throws: every
   * failure path releases the request, because a security agent that blocks a
   * page because it could not reach its control plane has turned our outage
   * into the customer's.
   */
  protect(
    request: Request,
    context?: { ip?: string; waitUntil?: (promise: Promise<unknown>) => void },
  ): Promise<Response | null>;
}

/**
 * The version of this integration, as published.
 *
 * Reported to the control plane alongside the agent kind, so a deployment can
 * be identified from the console without asking anyone which version they
 * installed.
 */
export declare const INTEGRATION_VERSION: string;

/**
 * Build a guard without wrapping a handler.
 *
 * Useful when you want to decide for yourself what to do with the refusal —
 * logging it, or answering with your own body. `withRelintio` is this plus the
 * wrapping.
 */
export declare function createGuard(options?: RelintioOptions): EdgeGuard;

/** A Deno request handler, as `Deno.serve` expects one. */
export type DenoHandler = (
  request: Request,
  info?: { remoteAddr?: { hostname?: string } },
) => Response | Promise<Response>;

/**
 * Wrap a Deno handler so Relintio assesses each request before it runs.
 *
 * A refused request is answered by the agent and the handler never runs — no
 * database connection is opened, nothing is billed to the function. Anything
 * else reaches the handler and its response is returned untouched.
 *
 * ```ts
 * import { withRelintio } from 'jsr:@relintio/supabase';
 *
 * Deno.serve(withRelintio(async (request) => new Response('hello')));
 * ```
 */
export declare function withRelintio(
  handler: DenoHandler,
  options?: RelintioOptions,
): DenoHandler;

export default withRelintio;
