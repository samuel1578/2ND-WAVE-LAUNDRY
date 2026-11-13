import "server-only";

/**
 * Server-only entry point for the Brevo client. The implementation lives in
 * `./brevo-core` (no `server-only` import) so tests can load it; application
 * code imports this module so a client bundle can never include it.
 */
export * from "./brevo-core";
