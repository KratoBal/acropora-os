"use client";

import { Alert, Button } from "@acropora/ui";
import { useEffect, useRef, useState } from "react";

import { rc } from "@/lib/api";
import { PRIVACY_NOTICE_LINES, PRIVACY_NOTICE_VERSION } from "@/lib/consent";
import {
  APPLE_SCRIPT,
  GOOGLE_SCRIPT,
  loadScript as realLoadScript,
} from "@/lib/external-scripts";
import { newRawNonce, sha256Hex } from "@/lib/nonce";
import {
  OUTDATED_NOTICE_TEXT,
  OUTDATED_NOTICE_TITLE,
  usePrivacyConsent,
} from "@/lib/privacy-consent";
import { fetchPublicConfig, type PublicConfig } from "@/lib/public-config";

/**
 * Google and Apple sign-in under the e-mail form (plan 3.2). The page gets the
 * provider's ID token and gives it to the server, which verifies signature,
 * issuer, audience and expiry itself; nothing here is trusted. A method whose
 * client id is not set is not shown (the server answers 503 for it too).
 *
 * THE CONSENT: an external sign-in can CREATE the account, and the server then
 * needs the privacy notice's version ("Az első belépéshez el kell fogadni az
 * adatkezelési tájékoztatót", 422). The version is sent only if the box is
 * ticked, so a returning user is not asked for it; if the server needs it, its
 * words are shown and the box is the thing to tick. No e-mail merging: a
 * second account with the same address gets the server's 409, as it is.
 *
 * THE VERSION THE PAGE SHOWS must be the one the server expects (card 33780bcb,
 * as in the registration form): when the server answers with another version,
 * the box is off and cannot be ticked, so no acceptance is collected for a
 * text the server no longer holds. Signing in with an existing account still
 * works (no version is sent for it). An unreadable answer blocks nothing: the
 * server's check is the authority.
 */
export function ExternalSignIn({
  loadScript = realLoadScript,
  loadConfig = () => fetchPublicConfig(),
  navigate = (path) => window.location.assign(path),
}: {
  loadScript?: (src: string) => Promise<void>;
  loadConfig?: () => Promise<PublicConfig>;
  /** A FULL page load, see `finish`; a test passes its own. */
  navigate?: (path: string) => void;
}) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [accepted, setAccepted] = useState(false);
  const acceptedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleButton = useRef<HTMLDivElement>(null);
  const notice = usePrivacyConsent();
  const outdated = notice === "outdated";

  // read by the provider's callback at the moment it fires; never true for an outdated text
  acceptedRef.current = accepted && !outdated;

  useEffect(() => {
    let alive = true;
    void loadConfig().then((found) => {
      if (alive) setConfig(found);
    });
    return () => {
      alive = false;
    };
    // the config is read once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish(
    path: "/auth/google" | "/auth/apple",
    body: Record<string, string>,
  ) {
    setBusy(true);
    setError(null);
    try {
      await rc("POST", path, {
        body: {
          ...body,
          ...(acceptedRef.current
            ? { consentVersion: PRIVACY_NOTICE_VERSION }
            : {}),
        },
      });
      // A FULL page load, not a client-side navigation (barracuda, #1741 note a):
      // the provider's script (Google or Apple) would otherwise stay in the
      // page and keep running on the signed-in pages, on this origin, next to
      // the readable CSRF cookie. A fresh load starts without it, and reads
      // the session itself.
      navigate("/");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A belépés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Google: the provider draws its own button; the credential comes to the callback.
  useEffect(() => {
    const clientId = config?.googleClientId;
    if (!clientId) return;
    let alive = true;
    void loadScript(GOOGLE_SCRIPT)
      .then(() => {
        const google = window.google;
        if (!alive || !google || !googleButton.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          callback: ({ credential }) => {
            if (credential)
              void finish("/auth/google", { idToken: credential });
          },
        });
        google.accounts.id.renderButton(googleButton.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          locale: "hu",
          width: 320,
        });
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(
            cause instanceof Error
              ? cause.message
              : "A Google-belépés nem töltődött be.",
          );
      });
    return () => {
      alive = false;
    };
    // `finish` only reads refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.googleClientId]);

  async function apple() {
    if (!config?.appleClientId) return;
    setError(null);
    try {
      await loadScript(APPLE_SCRIPT);
      const appleId = window.AppleID;
      if (!appleId) throw new Error("Az Apple-belépés nem töltődött be.");
      const raw = newRawNonce();
      appleId.auth.init({
        clientId: config.appleClientId,
        scope: "email",
        redirectURI: config.appleRedirectUri ?? window.location.origin,
        // POPUP MODE: the token comes back through this page to the server, and the
        // nonce binds it there, so `state` is not compared with the answer. If this
        // ever switches to redirect mode, comparing `state` becomes mandatory
        // (barracuda, #1741 note b).
        state: newRawNonce(),
        nonce: await sha256Hex(raw),
        usePopup: true,
      });
      const result = await appleId.auth.signIn();
      const idToken = result.authorization?.id_token;
      if (idToken) await finish("/auth/apple", { idToken, nonce: raw });
    } catch (cause) {
      // closing the popup is a choice, not an error
      const code = (cause as { error?: string } | null)?.error;
      if (
        code === "popup_closed_by_user" ||
        code === "user_cancelled_authorize"
      )
        return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Az Apple-belépés nem sikerült.",
      );
    }
  }

  if (!config || (!config.googleClientId && !config.appleClientId)) return null;

  return (
    <section
      aria-label="Belépés külső fiókkal"
      className="mt-6 space-y-3 border-t border-line pt-5"
    >
      <p className="text-center text-sm text-pilot-grey-600">vagy</p>
      {error ? (
        <Alert
          variant="danger"
          title="A belépés nem sikerült"
          description={error}
        />
      ) : null}
      {outdated ? (
        <Alert
          variant="danger"
          title={OUTDATED_NOTICE_TITLE}
          description={OUTDATED_NOTICE_TEXT}
        />
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={accepted && !outdated}
          disabled={outdated}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>
          Új fiók esetén elfogadom az adatkezelési tájékoztatót (tervezet, a
          végleges szöveg jóváhagyásra vár).
        </span>
      </label>
      <details className="rounded-lg border border-line bg-pilot-grey-50 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">
          Az adatkezelési tájékoztató (tervezet)
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-pilot-grey-700">
          {PRIVACY_NOTICE_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <div className="flex flex-col items-center gap-3">
        {config.googleClientId ? (
          <div ref={googleButton} aria-label="Belépés Google-fiókkal" />
        ) : null}
        {config.appleClientId ? (
          <Button
            variant="secondary"
            size="lg"
            className="w-[320px]"
            disabled={busy}
            onClick={() => void apple()}
          >
            Belépés Apple-fiókkal
          </Button>
        ) : null}
      </div>
    </section>
  );
}
