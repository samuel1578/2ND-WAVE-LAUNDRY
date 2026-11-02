import { AuthHashForwarder } from "@/components/auth-hash-forwarder";
import { HomePage } from "@/components/home-page";
import { getPublicWebsiteSnapshot } from "@/lib/website/public";

export const revalidate = 60;

export default async function Page() {
  return (
    <main id="main">
      <AuthHashForwarder />
      <HomePage website={await getPublicWebsiteSnapshot()} />
    </main>
  );
}
