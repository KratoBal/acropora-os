import type { Metadata } from "next";

import { PublicQuotePage } from "@/components/quotes/public-quote-page";

export const metadata: Metadata = {
  title: "Árajánlat | Acropora",
  // a customer's private link: not for search engines
  robots: { index: false, follow: false },
};

export default async function AjanlatLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicQuotePage token={token} />;
}
