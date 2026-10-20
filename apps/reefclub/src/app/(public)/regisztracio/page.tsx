import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Regisztráció" };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Regisztráció"
      footer={
        <>
          Van már fiókod?{" "}
          <Link
            href="/belepes"
            className="font-semibold text-pilot-aqua-700 underline"
          >
            Belépés
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
