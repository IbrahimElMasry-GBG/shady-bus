/**
 * Test stub for the `server-only` package.
 *
 * The real module throws unless it is imported by a React Server Component
 * build, which is the point: it stops server code from being bundled into the
 * client. Under vitest there is no such build, so the guard is stubbed out and
 * the modules behind it can be tested directly.
 */
export {};
