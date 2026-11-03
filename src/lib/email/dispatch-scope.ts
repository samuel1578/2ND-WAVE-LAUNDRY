import {
    enquiryReceivedTemplates,
    newsletterInterestTemplates,
    type NotificationTemplate,
} from "./templates";

/**
 * Public form dispatches must only claim the template family created by that
 * form. Keep these scopes source-derived so omitting a route allowlist cannot
 * turn a public request into a drain of the shared outbox.
 */
const PUBLIC_DISPATCH_SCOPES: Record<string, readonly NotificationTemplate[]> = {
    enquiry_submit: enquiryReceivedTemplates,
    newsletter_interest_submit: newsletterInterestTemplates,
};

export function resolveDispatchTemplates(
    source: string,
    requested?: readonly NotificationTemplate[],
): readonly NotificationTemplate[] | undefined {
    return PUBLIC_DISPATCH_SCOPES[source] ?? requested;
}
