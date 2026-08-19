/**
 * Minimal `cloudflare:workers` shim for plain-Node tests.
 *
 * workerd provides the real `DurableObject` base class; under Node (test
 * harness) it is just a holder for the runtime-injected (ctx, env) that the
 * constructor already receives. Subclasses implement their own `fetch`, so a
 * no-op base class is sufficient for the tests to run.
 */
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
