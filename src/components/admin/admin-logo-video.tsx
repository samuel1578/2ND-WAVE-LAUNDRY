"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import { defaultLandingFor } from "@/lib/auth/permissions";
import type { AdminRole } from "@/lib/auth/roles";

export function AdminStaticLogo({ role }: { role?: AdminRole }) {
    const { resolvedTheme } = useTheme();
    const poster = resolvedTheme === "light" ? "/images/logo.png" : "/images/header-dark.png";

    return (
        <Link
            className="admin-logo-video"
            href={role ? defaultLandingFor(role) : "/admin"}
            aria-label="Admin overview"
        >
            <Image
                className="admin-logo-video__poster"
                src={poster}
                alt=""
                width={150}
                height={150}
                priority={false}
            />
        </Link>
    );
}
