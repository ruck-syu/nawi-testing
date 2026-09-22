/** Registers the `vitest` → shim resolution hook. Used via `node --import`. */
import { register } from 'node:module';

register('./vitest-resolver.mjs', import.meta.url);
