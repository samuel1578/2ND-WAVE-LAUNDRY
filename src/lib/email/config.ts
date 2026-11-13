import "server-only";

/**
 * Server-only entry point for transactional email configuration.
 *
 * The implementation lives in `./config-core` (no `server-only` import) so the
 * Node test runner, which cannot resolve `server-only`, can load it. Application
 * code imports this module so a client bundle can never include it.
 */
export * from "./config-core";
