"use client";

import type { CurrentUserResponse } from "@acropora/types";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { partnerApi } from "@/lib/api";

type AuthContextValue = {
  user: CurrentUserResponse | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * EGY KÉPESSÉG MEGLÉTÉT A SZERVER VÁLASZÁBÓL DÖNTI EL, NEM BEÉGETVE.
 *
 * A `user.navigation` a `/auth/me` válaszából jön, a szerver
 * `visibleNavigationFor(role)` hívásával számolva -- tehát azt tükrözi,
 * amit az ÉPPEN FUTÓ API tud, nem azt, amit ez a frontend-build a saját
 * `packages/types`-ában ismer. Ez szándékos: az `apps/partner` minden
 * beolvasztáskor AZONNAL élesre települ, az `apps/api` viszont csak
 * Balázs külön engedélyével -- egy `hasPermission()`-re épülő, kliens-
 * oldali ellenőrzés a frontend saját, ÚJ jog-tábláját mutatná akkor is,
 * ha az élő API ezt még nem ismeri, és egy menüpont/útvonal egy régi API
 * mellett hibázna az állatkert felhasználóinak (acrobot kérése,
 * msg_id 23542, 2026-09-25).
 */
export function hasNavigationEntry(
  user: CurrentUserResponse | null,
  entryId: string,
): boolean {
  return user?.navigation.some((entry) => entry.id === entryId) ?? false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUserResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void partnerApi
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(email, password) {
        /*
          A `/auth/login/password` válasza (`{ user: AuthenticatedUser }`)
          NEM hordozza a `navigation` mezőt -- azt csak a `/auth/me` adja
          vissza. Ha innen töltenénk fel a state-et, a belépés utáni első
          renderben a `hasNavigationEntry` mindig hamisat adna, akkor is,
          ha a jog megvan (ugyanaz a hiba-család, amit az API oldalán a
          mobil-login `CurrentUserResponse`-ra váltása már megelőz, lásd
          `auth.controller.ts` "A MENU ITT IS UTAZIK" kommentje). Ezért a
          bejelentkezés után külön lekérjük a `/auth/me`-t.
        */
        await partnerApi.login(email, password);
        setUser(await partnerApi.me());
      },
      async logout() {
        await partnerApi.logout().catch(() => undefined);
        setUser(null);
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
