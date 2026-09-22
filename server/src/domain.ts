/**
 * Re-export of the shared calculation package.
 *
 * The server imports the domain package by relative path rather than by its
 * `@r76/domain` workspace name, so the backend runs without `npm install` having
 * created a node_modules symlink. Centralising it here keeps the relative path in one
 * file: every other server module imports from `./domain.ts`.
 *
 * The client resolves the same code through a Vite alias, so both sides run byte-identical
 * rules.
 */
export * from '../../packages/domain/src/index.ts';
