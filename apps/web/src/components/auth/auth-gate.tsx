"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { loginPathFor } from "@/lib/auth/return-path";

import { useAuth } from "./auth-provider";

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // back to this page after signing in (acrobot 50078: the live draw opened in OBS landed on the dashboard)
    if (!isLoading && !session)
      router.replace(
        loginPathFor(`${window.location.pathname}${window.location.search}`),
      );
  }, [isLoading, router, session]);

  if (isLoading || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-dusk-50">
        <p className="text-sm font-medium text-dusk-500">
          Munkamenet ellenőrzése…
        </p>
      </main>
    );
  }

  return children;
}
