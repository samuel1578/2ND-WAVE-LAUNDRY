/** Server-side configuration for newsletter interest submissions (Phase 5 MVP).
 *
 * The feature is fail-closed: an unset or unparsable flag leaves submissions
 * disabled, so a deployment can never accept interest before the operator has
 * opted in (env vars set, Brevo template saved, migration applied).
 *
 * The manager recipient and the consent wording version are server constants.
 * No environment variable and no request value can change where the single
 * internal alert goes or which approved wording was captured.
 */

export const NEWSLETTER_RATE_LIMIT_MODE_VAR = "NEWSLETTER_RATE_LIMIT_MODE";

/**
 * Manager alert recipient (Phase 5 MVP decision: hardcoded, not an env var).
 * Also a verified Brevo sender identity, so the alert can be sent without any
 * new sender verification step.
 */
export const newsletterManagerEmail = "manager@2ndwavelaundry.com";

/** Server-approved opt-in wording version captured with every submission. */
export const newsletterConsentVersion = "2026-10-27";

export function readNewsletterInterestConfig(
    env: Record<string, string | undefined> = process.env,
) {
    const flag = (env.NEWSLETTER_INTEREST_ENABLED ?? "").trim().toLowerCase();
    return {
        enabled: flag === "true" || flag === "1" || flag === "yes",
        consentVersion: newsletterConsentVersion,
        managerEmail: newsletterManagerEmail,
    } as const;
}
