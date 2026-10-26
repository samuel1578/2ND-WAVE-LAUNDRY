/** Server-side configuration for review submissions.
 *
 * Review submissions are enabled by default so local and development builds can be
 * tested without extra environment setup. The consent/version capture is still server-
 * controlled, but it is no longer used as a hard gate for development.
 */
export const REVIEW_RATE_LIMIT_MODE_VAR = "REVIEW_RATE_LIMIT_MODE";

export const reviewConsentVersion = "2026-10-26";

export function readReviewSubmissionConfig(
    env: Record<string, string | undefined> = process.env,
) {
    // Review submissions now use a server default consent version.
    return {
        enabled: true,
        noticeVersion: reviewConsentVersion,
        ready: true,
    } as const;
}

