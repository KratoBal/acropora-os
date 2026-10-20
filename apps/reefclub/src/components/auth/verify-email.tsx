"use client";

import { Alert } from "@acropora/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { rc } from "@/lib/api";
import { tokenFromHash } from "@/lib/hash-token";

type State =
  | { status: "working" }
  | { status: "done" }
  | { status: "failed"; message: string };

/**
 * The link in the e-mail is `/email-megerosites#token=…`. The token is in the
 * fragment, which the browser never sends to a server or in a Referer header;
 * it is removed from the address bar right after it is read.
 */
export function VerifyEmail() {
  const [state, setState] = useState<State>({ status: "working" });

  useEffect(() => {
    const token = tokenFromHash(window.location.hash);
    if (!token) {
      setState({
        status: "failed",
        message:
          "Ez a link hibás: nincs benne megerősítő kód. Nyisd meg újra a levélből.",
      });
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    rc("POST", "/auth/verify-email", { body: { token } })
      .then(() => setState({ status: "done" }))
      .catch((cause: unknown) =>
        setState({
          status: "failed",
          message:
            cause instanceof Error
              ? cause.message
              : "A megerősítés nem sikerült.",
        }),
      );
  }, []);

  if (state.status === "working")
    return (
      <p role="status" className="text-sm text-pilot-grey-600">
        Megerősítés…
      </p>
    );
  if (state.status === "failed")
    return (
      <Alert
        variant="danger"
        title="A megerősítés nem sikerült"
        description={state.message}
      />
    );
  return (
    <div className="space-y-4">
      <Alert
        title="Az e-mail címed megerősítve"
        description="Most már be tudsz lépni."
      />
      <Link
        href="/belepes"
        className="font-semibold text-pilot-aqua-700 underline"
      >
        Tovább a belépéshez
      </Link>
    </div>
  );
}
