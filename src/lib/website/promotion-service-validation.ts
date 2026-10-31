const unavailableMessage = "The attached service is no longer available.";

export async function validatePromotionServiceSlug(
    value: unknown,
    isBookable: (slug: string) => Promise<boolean>,
): Promise<string | undefined> {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new Error(unavailableMessage);
    const slug = value.trim();
    if (!slug) return undefined;

    let available = false;
    try {
        available = await isBookable(slug);
    } catch {
        available = false;
    }
    if (!available) throw new Error(unavailableMessage);
    return slug;
}
