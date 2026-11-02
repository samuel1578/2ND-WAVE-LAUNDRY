import type { Metadata } from "next";
import { AuthHashForwarder } from "@/components/auth-hash-forwarder";
import { HomePage } from "@/components/home-page";
import { JsonLd } from "@/components/seo/json-ld";
import { faqSchema } from "@/lib/seo/schema";
import { pageMetadata } from "@/lib/seo/metadata";
import { getPublicWebsiteSnapshot } from "@/lib/website/public";

export const revalidate = 60;

const TITLE = "2nd Wave Laundry | Laundry Services in Ashaiman & Katamanso";
const DESCRIPTION =
  "2nd Wave Laundry Services washes, irons and folds everyday laundry, treats stains and cares for shoes across three branches in Ashaiman and Katamanso.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/",
  absoluteTitle: true,
});

export default async function Page() {
  const website = await getPublicWebsiteSnapshot();
  // The home page renders the first five FAQs; structured data mirrors exactly
  // that visible list.
  const visibleFaqs = website.faqs.slice(0, 5);
  return (
    <main id="main">
      <JsonLd data={faqSchema(visibleFaqs)} />
      <AuthHashForwarder />
      <HomePage website={website} />
    </main>
  );
}
