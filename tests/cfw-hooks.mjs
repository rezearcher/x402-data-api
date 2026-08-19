/**
 * Node module-resolution hook for plain-Node tests:
 *
 *  1. map the virtual `cloudflare:workers` specifier to the local shim, and
 *  2. retry failed relative imports with a `.ts` extension appended — the
 *     sources use extensionless relative imports (bundler-style), which Node
 *     type-stripping cannot resolve on its own.
 *
 * Loaded via `register()` before the app import — see the top of test_usage.js.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: new URL("./shim/cloudflare-workers.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Only retry relative/file specifiers that are missing an extension.
    const looksRelative =
      specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file:");
    if (looksRelative && !/\.[a-z0-9]+$/i.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw err;
  }
}
