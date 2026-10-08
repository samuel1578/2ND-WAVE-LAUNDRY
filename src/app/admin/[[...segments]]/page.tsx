import { AdminApp } from "@/components/admin/admin-app";
import type { Metadata } from "next";
import { demoMode } from "@/lib/content";
export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { segments = [] } = await params;
  const query = await searchParams;
  return (
    <AdminApp segments={segments} state={demoMode ? query.state : undefined} />
  );
}
