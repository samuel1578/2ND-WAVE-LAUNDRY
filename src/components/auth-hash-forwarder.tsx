"use client";

import { useEffect } from "react";

/** Catch legacy Supabase implicit-flow invitation/recovery links that arrive at
 * the public origin and forward their fragment without dropping its tokens. */
export function AuthHashForwarder() {
    useEffect(() => {
        const hash = window.location.hash;
        if (!hash) return;
        const params = new URLSearchParams(hash.slice(1));
        const type = params.get("type");
        const hasSessionTokens = Boolean(params.get("access_token") && params.get("refresh_token"));
        if (hasSessionTokens && (type === "invite" || type === "recovery")) {
            window.location.replace(`/admin/set-password${hash}`);
        }
    }, []);

    return null;
}
