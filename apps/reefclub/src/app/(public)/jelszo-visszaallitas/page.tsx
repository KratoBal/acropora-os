import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { PasswordReset } from "@/components/auth/password-reset";

export const metadata: Metadata = { title: "Jelszó visszaállítása" };

export default function PasswordResetPage() {
  return (
    <AuthCard
      title="Jelszó visszaállítása"
      footer={
        <Link
          href="/belepes"
          className="font-semibold text-pilot-aqua-700 underline"
        >
          Vissza a belépéshez
        </Link>
      }
    >
      <PasswordReset />
    </AuthCard>
  );
}
