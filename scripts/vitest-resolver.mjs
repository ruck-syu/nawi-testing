/**
 * Module resolution hook that points the bare specifier `vitest` at our local shim.
 *
 * This keeps the test files idiomatic — they import from 'vitest' like any other project —
 * while letting the suite run with an empty node_modules. Nothing else is intercepted.
 */

const SHIM = new URL('./vitest-shim.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'vitest' || specifier === 'vitest/globals') {
    return { url: SHIM, shortCircuit: true, format: 'module' };
  }
  return next(specifier, context);
}
