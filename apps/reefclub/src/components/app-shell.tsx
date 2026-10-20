"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { RequireSession, useSession } from "@/lib/session";

/** The frame of the signed-in pages: the name, the places, the way out. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <Frame>{children}</Frame>
    </RequireSession>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { state, signOut } = useSession();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link
            href="/akvariumok"
            className="font-display text-lg font-semibold text-pilot-aqua-700"
          >
            ReefClub
          </Link>
          <nav
            aria-label="Fő menü"
            className="flex gap-4 text-sm font-semibold"
          >
            <Link href="/akvariumok" className="hover:underline">
              Akváriumok
            </Link>
            <Link href="/fiok" className="hover:underline">
              Fiók
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {state.status === "user" ? (
              <span className="hidden text-pilot-grey-600 sm:inline">
                {state.me.email}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut()}
              className="font-semibold text-pilot-aqua-700 hover:underline"
            >
              Kilépés
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
      <p className="pb-6 text-center text-xs text-pilot-grey-500">
        Teszt környezet.
      </p>
    </div>
  );
}
