/**
 * THE TWO PROVIDER SCRIPTS, loaded only when that sign-in method is switched
 * on and only on the pages that show its button. Both are the providers' own
 * documented URLs; they change without notice, so a pinned integrity hash is
 * not possible. They are not loaded for a visitor on a page without the button.
 */
export const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";
export const APPLE_SCRIPT =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

const pending = new Map<string, Promise<void>>();

/** Loads a script once; a second call returns the same promise. */
export function loadScript(src: string): Promise<void> {
  const existing = pending.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const element = document.createElement("script");
    element.src = src;
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => {
      pending.delete(src);
      reject(new Error(`A szkript nem töltődött be: ${new URL(src).host}`));
    };
    document.head.appendChild(element);
  });
  pending.set(src, promise);
  return promise;
}

/** What this app uses of the two provider globals. */
export interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback(response: { credential?: string }): void;
        ux_mode?: "popup";
      }): void;
      renderButton(
        element: HTMLElement,
        options: Record<string, string | number>,
      ): void;
    };
  };
}

export interface AppleIdAuth {
  auth: {
    init(options: {
      clientId: string;
      scope: string;
      redirectURI: string;
      state: string;
      nonce: string;
      usePopup: boolean;
    }): void;
    signIn(): Promise<{ authorization?: { id_token?: string } }>;
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
    AppleID?: AppleIdAuth;
  }
}
