import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContentCreatePage } from "./content-create-page";
import { ContentListPage } from "./content-list-page";

const api = vi.hoisted(() => ({
  waiting: vi.fn(),
  waitingOnMe: vi.fn(),
  waitingForImage: vi.fn(),
  create: vi.fn(),
  createIdea: vi.fn(),
  ideas: vi.fn(),
}));

vi.mock("@/lib/api/content", () => ({ contentApi: api }));

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/**
 * A MUNKAMENET AZ ELES ALAKJABAN: NINCS BENNE TOKEN.
 *
 * Ez a fajl EGYETLEN oka, es a mock legfontosabb resze. Eles, suti-alapu
 * bejelentkezesnel a bongeszo a httpOnly sutit kuldi, es a kliens NEM lat
 * tokent -- ezt a `lib/api/client.ts` sajat megjegyzese ki is mondja. A
 * `session.token` tipusban is opcionalis.
 *
 * A masik komponens-teszt ebben a mappaban `token: "token-1"` erteket ad, es
 * `content.view` joggal fut. Ketto miatt sem latta ezt a hibat: token VAN
 * benne, es a felviteli gomb `content.manage` nelkul meg sem jelenik.
 */
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "user-1",
        email: "b@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        permissions: ["content.view", "content.manage"],
      },
    },
  }),
}));

beforeEach(() => {
  api.waiting.mockReset().mockResolvedValue([]);
  api.waitingOnMe.mockReset().mockResolvedValue({ items: [], notCovered: [] });
  api.waitingForImage.mockReset().mockResolvedValue([]);
  api.create.mockReset().mockResolvedValue({ id: "uj" });
  api.createIdea.mockReset().mockResolvedValue({ id: "otlet" });
  api.ideas.mockReset().mockResolvedValue([]);
});

describe("putting a piece in, as it happens in production", () => {
  /**
   * A VÉDELEM, AMI ÁTKÖLTÖZÖTT, DE NEM VESZETT EL.
   *
   * A hiba, amit Balázs élesben talált: a felirat eltűnt kattintásra, és utána
   * nem volt hova írni. A felület nem hibázott és nem is szólt.
   *
   * AMI ÁTENGEDTE: a felvitel feltétele tartalmazta a tokent is, és éles
   * munkamenetben a token ÜRES. A típusellenőrzés ezt nem láthatta (az üres
   * sztring érvényes sztring).
   *
   * A felvitel azóta KÜLÖN OLDALON áll, tehát a régi alak (gomb, majd mezők
   * ugyanazon a lapon) már nem létezik. A KÉRDÉS viszont változatlan: üres
   * tokennel is látszanak-e a mezők. Ezért az állítás nem törlődött, hanem
   * átkerült az új oldalra.
   */
  it("shows the fields with no client token", async () => {
    render(<ContentCreatePage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Cím")).toBeTruthy();
    });
    expect(screen.getByLabelText("Csatorna")).toBeTruthy();
  });

  /**
   * UGYANAZ A KÉRDÉS AZ ÖTLET-MÓDRA, ÉS KÜLÖN ÁLLÍTÁSKÉNT.
   *
   * A két mód ugyanazon a feltételes ágon áll, tehát ha a token üressége
   * elrejtené az egyiket, elrejtené a másikat is. Egy állítás a kettőre egyben
   * nem mondaná meg, melyik törött.
   */
  it("shows the idea fields too, with no client token", async () => {
    render(<ContentCreatePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Ötlet feljegyzése/ }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Cím")).toBeTruthy();
    });
    // AZ ÖTLET KEVESEBBET KÉR: a szöveg-mező NINCS ott, nem csak rejtve van.
    expect(screen.queryByLabelText("Szöveg")).toBeNull();
  });

  /**
   * A LISTA MÁR NEM VISZ FEL, CSAK ÁTENGED.
   *
   * Ez az állítás azt védi, ami a döntés lényege volt: a lista lektorálásra
   * való. Ha valaki visszatenné az űrlapot a lista tetejére, ez pirosodik.
   */
  it("the list only links to the form, it does not contain it", async () => {
    render(<ContentListPage />);

    const link = await screen.findByRole("link", {
      name: /Új tétel felvitele/,
    });
    expect(link.getAttribute("href")).toBe("/tartalom/uj");
    expect(screen.queryByLabelText("Cím")).toBeNull();
  });
});
