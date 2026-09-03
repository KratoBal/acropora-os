import type { LockReason } from "./restore-session";
import type { AuthenticatedUser } from "./types";

export type AuthStatus =
  | "restoring"
  /**
   * A usable session is on disk, but the device did not confirm the
   * owner. Distinct from `unauthenticated` on purpose: there is still
   * something to unlock, so the UI can offer another attempt instead of
   * only a password form.
   */
  | "locked"
  | "unauthenticated"
  | "authenticated"
  | "signingIn"
  | "signingOut";

export interface AuthState {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  expiresAt: string | null;
  /** True only while `status === "restoring"` and the last attempt to
   * reach `/auth/me` failed with a transient network error rather than an
   * auth rejection. The stored token is intentionally NOT cleared in this
   * case (see restore-session.ts) — the UI should show a retryable
   * connectivity state instead of bouncing to the login screen. */
  restoreNetworkError: boolean;
  /** Generic, non-revealing message for the last failed sign-in attempt. */
  signInError: string | null;
  /** Why the gate is shut, when `status === "locked"`. Drives what the
   * locked screen may offer: another attempt is only worth a button on a
   * device that has something to attempt. */
  lockReason: LockReason | null;
  /**
   * TRUE, HA A MUNKAMENET A LEMEZROL JOTT, NEM A SZERVERTOL.
   *
   * A statusz ilyenkor is `authenticated` -- a kollega dolgozhat --, DE a
   * kulonbseg nem elhanyagolhato, es ezert kulon mezo, nem egy hatodik statusz:
   * minden kepernyo, ami ma az `authenticated` allapotra epul, valtozatlanul
   * mukodik, es CSAK az veszi eszre a kulonbseget, aki keresi.
   *
   * AMIT A FELULETNEK KI KELL MONDANIA: hogy nincs halozat, es hogy a jogkorok
   * a legutobbi ellenorzes szerintiek. Egy visszavont jogosultsag legfeljebb 24
   * oraig nem latszik -- ez Balazs dontesenek az ara, es a kollega csak akkor
   * tud vele szamolni, ha tudja, hogy offline all.
   */
  offline: boolean;
}

export const initialAuthState: AuthState = {
  status: "restoring",
  user: null,
  expiresAt: null,
  restoreNetworkError: false,
  signInError: null,
  lockReason: null,
  offline: false,
};

export type AuthAction =
  | { type: "RESTORE_RETRY" }
  | { type: "RESTORE_UNAUTHENTICATED" }
  | {
      type: "RESTORE_AUTHENTICATED";
      user: AuthenticatedUser;
      expiresAt: string;
    }
  | { type: "RESTORE_NETWORK_ERROR" }
  /**
   * A tarolt munkamenettel indultunk, halozat nelkul. Kulon esemeny, nem a
   * `RESTORE_AUTHENTICATED` egy jelzovel: a ket ut MAS bizonyitekon all (az
   * egyik a szerver valaszan, a masik a lemezen), es egy kozos esemeny a
   * kulonbseget a hivora bizna.
   */
  | {
      type: "RESTORE_AUTHENTICATED_OFFLINE";
      user: AuthenticatedUser;
      expiresAt: string;
    }
  /** `reason` is absent when the gate simply closed and nobody has been
   * asked yet - coming back to the foreground after a long absence. It is
   * present when an attempt ran and did not open it. */
  | { type: "SESSION_LOCKED"; reason?: LockReason }
  | { type: "SIGN_IN_START" }
  | { type: "SIGN_IN_SUCCESS"; user: AuthenticatedUser; expiresAt: string }
  | { type: "SIGN_IN_ERROR"; message: string }
  | { type: "SIGN_OUT_START" }
  | { type: "SIGN_OUT_DONE" };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "RESTORE_RETRY":
      return { ...initialAuthState, status: "restoring" };
    case "RESTORE_UNAUTHENTICATED":
      return { ...initialAuthState, status: "unauthenticated" };
    case "RESTORE_AUTHENTICATED":
      return {
        status: "authenticated",
        user: action.user,
        expiresAt: action.expiresAt,
        restoreNetworkError: false,
        signInError: null,
        lockReason: null,
        offline: false,
      };
    case "RESTORE_AUTHENTICATED_OFFLINE":
      /**
       * A `restoreNetworkError` HAMIS lesz, pedig halozati hiba tortent.
       *
       * Ez szandekos: az a mezo azt vezerli, hogy a felulet UJRAPROBALAST
       * kinaljon a visszaallitas kozben. Itt a visszaallitas BEFEJEZODOTT --
       * mas eredmennyel, mint online, de befejezodott. Ha igazra allitanank, a
       * kepernyo egyszerre mutatna bejelentkezett allapotot es egy "probald
       * ujra" savot, ami ugyanarra a mar lezart lepesre mutat.
       */
      return {
        status: "authenticated",
        user: action.user,
        expiresAt: action.expiresAt,
        restoreNetworkError: false,
        signInError: null,
        lockReason: null,
        offline: true,
      };
    case "RESTORE_NETWORK_ERROR":
      return { ...state, status: "restoring", restoreNetworkError: true };
    case "SESSION_LOCKED":
      // Nothing about the stored session changes here - only that it has
      // not been unlocked yet. The user is deliberately kept: when the
      // gate closes on a running app, remembering who is locked out is
      // what lets the way back in skip the server (see
      // resume-session.ts), and the screen can greet them by name instead
      // of showing an anonymous wall.
      return {
        ...state,
        status: "locked",
        lockReason: action.reason ?? null,
        restoreNetworkError: false,
        signInError: null,
      };
    case "SIGN_IN_START":
      return { ...state, status: "signingIn", signInError: null };
    case "SIGN_IN_SUCCESS":
      return {
        status: "authenticated",
        user: action.user,
        expiresAt: action.expiresAt,
        restoreNetworkError: false,
        signInError: null,
        lockReason: null,
        // Egy sikeres bejelentkezes ONLINE tortent: a szerver most adta a
        // tokent. Ez az egyetlen hely, ahol ez biztosan allithato.
        offline: false,
      };
    case "SIGN_IN_ERROR":
      return {
        ...initialAuthState,
        status: "unauthenticated",
        signInError: action.message,
      };
    case "SIGN_OUT_START":
      return { ...state, status: "signingOut" };
    case "SIGN_OUT_DONE":
      return { ...initialAuthState, status: "unauthenticated" };
    default:
      return state;
  }
}
