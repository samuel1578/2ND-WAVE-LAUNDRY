"use client";

import Image from "next/image";
import { useTheme } from "next-themes";

export function AdminStaticLogo() {
    const { resolvedTheme } = useTheme();
    const poster = resolvedTheme === "light" ? "/images/logo.png" : "/images/header-dark.png";

    return (
        <div className="admin-logo-video" aria-hidden="true">
            <Image
                className="admin-logo-video__poster"
                src={poster}
                alt=""
                width={150}
                height={150}
                priority={false}
            />
        </div>
    );
}
