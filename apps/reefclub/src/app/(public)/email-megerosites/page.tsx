import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/auth-card";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = { title: "E-mail megerősítése" };

export default function VerifyEmailPage() {
  return (
    <AuthCard title="E-mail megerősítése">
      <VerifyEmail />
    </AuthCard>
  );
}
