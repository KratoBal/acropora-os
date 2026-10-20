import type { Metadata } from "next";

import { Account } from "@/components/account";

export const metadata: Metadata = { title: "Fiók" };

export default function AccountPage() {
  return <Account />;
}
