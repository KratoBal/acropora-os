"use client";

import { useEffect, useState } from "react";

import { rc } from "./api";
import { PRIVACY_NOTICE_VERSION } from "./consent";

/**
 * Whether the privacy notice this page shows is the one the SERVER expects
 * (card 33780bcb, the same rule as the sharing consent). The server accepts a
 * registration only under its own current version and says so at
 * GET /rc/v1/auth/privacy-consent. A page showing an older text must not
 * collect an acceptance for it.
 *
 * ONLY A KNOWN MISMATCH BLOCKS. If the answer cannot be read, the page is not
 * stopped: the server's check is the authority, and its words are shown if it
 * refuses.
 */
export type PrivacyConsentState =
  "checking" | "current" | "outdated" | "unknown";

export function usePrivacyConsent(): PrivacyConsentState {
  const [state, setState] = useState<PrivacyConsentState>("checking");

  useEffect(() => {
    let alive = true;
    rc<{ version?: unknown }>("GET", "/auth/privacy-consent")
      .then((answer) => {
        if (!alive) return;
        setState(
          answer.version === PRIVACY_NOTICE_VERSION ? "current" : "outdated",
        );
      })
      .catch(() => {
        if (alive) setState("unknown");
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

export const OUTDATED_NOTICE_TITLE =
  "Az adatkezelési tájékoztató szövege frissítés alatt";
export const OUTDATED_NOTICE_TEXT =
  "A szerver másik szövegverziót vár, mint amit ez az oldal mutat, ezért most nem lehet elfogadni. Próbáld újra később.";
