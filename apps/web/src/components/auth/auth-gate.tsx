"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { useAuth } from "./auth-provider";

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !session) router.replace("/login");
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
