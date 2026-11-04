import type {
    BlogArticleSnapshot,
    BlogContentBlock,
    BlogAuthor,
    ContentItem,
} from "@/lib/contracts";

export type BlogSaveAction = "draft" | "publish" | "archive" | "unpublish";
export type BlogPayload = BlogArticleSnapshot & {
    status: "Draft" | "Published" | "Archived";
    draft?: BlogArticleSnapshot;
};

function cleanAuthor(author: BlogAuthor | undefined): BlogAuthor | undefined {
    if (!author) return undefined;
    const cleaned: BlogAuthor = {
        name: author.name.trim(),
        ...(author.bio?.trim() ? { bio: author.bio.trim() } : {}),
        ...(author.image?.trim() ? { image: author.image.trim() } : {}),
        ...(author.imageAlt?.trim() ? { imageAlt: author.imageAlt.trim() } : {}),
        ...(author.imageMediaId?.trim() ? { imageMediaId: author.imageMediaId.trim() } : {}),
    };
    return cleaned.name || cleaned.bio || cleaned.image || cleaned.imageMediaId
        ? cleaned
        : undefined;
}

function orderedBlocks(blocks: BlogContentBlock[] | undefined): BlogContentBlock[] | undefined {
    if (!blocks?.length) return undefined;
    return blocks.map((block, index) =>
        block.type === "text"
            ? { type: "text", text: block.text, order: index + 1 }
            : {
                type: "image",
                mediaId: block.mediaId,
                src: block.src,
                alt: block.alt,
                caption: block.caption,
                order: index + 1,
            },
    );
}

function snapshotFromItem(item: ContentItem): BlogArticleSnapshot {
    const contentBlocks = orderedBlocks(item.contentBlocks);
    const blockText = contentBlocks
        ?.filter((block): block is Extract<BlogContentBlock, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");
    return {
        title: item.title,
        slug: item.slug,
        summary: item.summary,
        body: blockText?.trim() ? blockText : item.body,
        image: item.image,
        alt: item.alt,
        ...(item.imageMediaId ? { imageMediaId: item.imageMediaId } : {}),
        ...(cleanAuthor(item.author) ? { author: cleanAuthor(item.author) } : {}),
        ...(contentBlocks ? { contentBlocks } : {}),
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        ...(item.modifiedAt ? { modifiedAt: item.modifiedAt } : {}),
        extra: { ...item.extra },
    };
}

function snapshotToPayload(snapshot: BlogArticleSnapshot): BlogArticleSnapshot {
    return {
        title: snapshot.title,
        slug: snapshot.slug,
        summary: snapshot.summary,
        body: snapshot.body,
        image: snapshot.image,
        alt: snapshot.alt,
        ...(snapshot.imageMediaId ? { imageMediaId: snapshot.imageMediaId } : {}),
        ...(snapshot.author ? { author: { ...snapshot.author } } : {}),
        ...(snapshot.contentBlocks ? { contentBlocks: orderedBlocks(snapshot.contentBlocks) } : {}),
        ...(snapshot.publishedAt ? { publishedAt: snapshot.publishedAt } : {}),
        ...(snapshot.modifiedAt ? { modifiedAt: snapshot.modifiedAt } : {}),
        extra: { ...(snapshot.extra ?? {}) },
    };
}

/**
 * Creates the backward-compatible JSON payload consumed by website_content.
 * Published fields remain at the existing top level while an editor saves a
 * draft, so current and older public readers continue to see the published copy.
 */
export function buildBlogPayload(
    item: ContentItem,
    action: BlogSaveAction,
    now = new Date().toISOString(),
): { payload: BlogPayload; published: boolean } {
    const current = snapshotFromItem(item);
    if (action === "draft" && item.published) {
        return {
            payload: {
                ...snapshotToPayload(item.published),
                status: "Published",
                draft: {
                    ...current,
                    ...(item.published.publishedAt ? { publishedAt: item.published.publishedAt } : {}),
                    ...(item.published.modifiedAt ? { modifiedAt: item.published.modifiedAt } : {}),
                },
            },
            published: true,
        };
    }

    if (action === "publish") {
        const payload = snapshotToPayload(current);
        payload.publishedAt = item.published?.publishedAt ?? item.publishedAt ?? now;
        payload.modifiedAt = now;
        return { payload: { ...payload, status: "Published" }, published: true };
    }

    const payload = snapshotToPayload(current);
    if (item.published?.publishedAt ?? item.publishedAt) {
        payload.publishedAt = item.published?.publishedAt ?? item.publishedAt;
    }
    if (item.published?.modifiedAt ?? item.modifiedAt) {
        payload.modifiedAt = item.published?.modifiedAt ?? item.modifiedAt;
    }
    return {
        payload: {
            ...payload,
            status: action === "archive" ? "Archived" : "Draft",
        },
        published: false,
    };
}

export function blogMediaIds(item: ContentItem): string[] {
    const ids = new Set<string>();
    const collect = (snapshot: BlogArticleSnapshot | undefined) => {
        if (!snapshot) return;
        if (snapshot.imageMediaId) ids.add(snapshot.imageMediaId);
        if (snapshot.author?.imageMediaId) ids.add(snapshot.author.imageMediaId);
        for (const block of snapshot.contentBlocks ?? []) {
            if (block.type === "image" && block.mediaId) ids.add(block.mediaId);
        }
    };
    collect(snapshotFromItem(item));
    collect(item.published);
    return [...ids];
}
