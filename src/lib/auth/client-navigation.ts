/**
 * True for the control-flow errors Next.js throws to trigger navigation after a
 * server action calls `redirect()`. Client components must not surface these as
 * user-facing failures.
 */
export function isFrameworkNavigation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR)/.test(digest)
  );
}
