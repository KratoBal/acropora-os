import Link from "next/link";
import type { ReactNode } from "react";

/** The frame of every public page: the name, one card, and the links between the pages. */
export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link
        href="/"
        className="text-center font-display text-2xl font-semibold text-pilot-aqua-700"
      >
        ReefClub
      </Link>
      <section className="rounded-xl border border-line bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </section>
      {footer ? (
        <p className="text-center text-sm text-pilot-grey-600">{footer}</p>
      ) : null}
      <p className="text-center text-xs text-pilot-grey-500">
        Teszt környezet.
      </p>
    </main>
  );
}
