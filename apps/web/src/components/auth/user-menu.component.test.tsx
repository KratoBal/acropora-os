import { fireEvent, render, screen } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserMenu } from "./user-menu";

const auth = vi.hoisted(() => ({
  session: null as Session | null,
  logout: vi.fn(),
}));

vi.mock("./auth-provider", () => ({
  useAuth: () => ({ session: auth.session, logout: auth.logout }),
}));

const ownerSession: Session = {
  id: "owner-session",
  token: "owner-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Owner",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

/**
 * ÉLES REGRESSZIÓ A #1122 (Codex ÚJ WEB-KERET) UTÁN, BALÁZS KÉPERNYŐFOTÓJA
 * ALAPJÁN (acrobot, msg_id 23608, 2026-09-25): a lenyíló ÁTLÁTSZÓ volt, az
 * oldal szövege átlátszott rajta.
 *
 * A GYÖKÉR OK, MÉRVE: a dobozon `bg-pilot-white` állt, egy Tailwind-osztály,
 * amihez a `packages/ui/src/figma-theme.css` `@theme` blokkja SOHA nem
 * definiált `--color-pilot-white` tokent (nulla találat a fájlban és a
 * repó egészében) -- ez az osztály tehát NEM generál CSS-t, a dobozon
 * emiatt nincs semmilyen háttér, ezért látszik át rajta az alatta lévő
 * tartalom. A javítás a MEGLÉVŐ, a téma-réteg által ismert `bg-white`-ra
 * állítja át.
 *
 * A HATÁR: a `happy-dom` teszt-környezet nem tölt be CSS-t, tehát a
 * ténylegesen számított hátteret itt nem lehet megmérni -- ez az állítás
 * az OSZTÁLYNEVET ellenőrzi, ami a CSS-illeszkedés előfeltétele.
 */
describe("UserMenu lenyíló háttere", () => {
  beforeEach(() => {
    auth.session = ownerSession;
  });

  it("a lenyíló a valódi bg-white osztályt viseli, nem a sosem létezett bg-pilot-white-ot", () => {
    render(
      <UserMenu preference="system" onPreferenceChange={() => undefined} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Felhasználói menü" }));

    const dropdown = screen.getByRole("button", {
      name: "Kijelentkezés",
    }).parentElement;
    expect(dropdown).not.toBeNull();
    expect(dropdown).toHaveClass("bg-white");
    expect(dropdown?.className).not.toMatch(/\bbg-pilot-white\b/);
  });
});
