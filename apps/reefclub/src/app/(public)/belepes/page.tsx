import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ExternalSignIn } from "@/components/auth/external-sign-in";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Belépés" };

export default function LoginPage() {
  return (
    <AuthCard
      title="Belépés"
      footer={
        <>
          Még nincs fiókod?{" "}
          <Link
            href="/regisztracio"
            className="font-semibold text-pilot-aqua-700 underline"
          >
            Regisztráció
          </Link>
          {" · "}
          <Link
            href="/jelszo-visszaallitas"
            className="font-semibold text-pilot-aqua-700 underline"
          >
            Elfelejtett jelszó
          </Link>
        </>
      }
    >
      <LoginForm />
      <ExternalSignIn />
    </AuthCard>
  );
}
