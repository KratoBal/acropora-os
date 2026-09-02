import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
   * EGY ALLITAS, ES A MEZOK LETEZESET MERI.
   *
   * A hiba, amit Balazs elesben talalt: a felirat eltunt kattintasra, es utana
   * nem volt hova irni. A felulet nem hibazott es nem is szolt -- egyszeruen
   * nem jelent meg semmi.
   *
   * AMI ATENGEDTE: a felvitel feltetele tartalmazta a tokent is, es eles
   * munkamenetben a token URES. A tipusellenorzes ezt nem lathatta (az ures
   * sztring ervenyes sztring), es egyetlen teszt sem renderelte ezt az utat.
   */
  it("shows the fields after the button is pressed, with no client token", async () => {
    render(<ContentListPage />);

    const gomb = await screen.findByRole("button", {
      name: "Új tartalom felvétele",
    });
    fireEvent.click(gomb);

    await waitFor(() => {
      expect(screen.getByLabelText("Cím")).toBeTruthy();
    });
  });

  /**
   * UGYANAZ A KERDES A MASODIK GOMBRA, ES KULON ALLITASKENT.
   *
   * Az otlet-urlap ugyanazon a felteteles agon all, tehat ha a token uressege
   * elrejti az egyiket, elrejti a masikat is. Egy allitas a ket gombra egyben
   * nem mondana meg, melyik torott -- ezert ketto.
   */
  it("shows the idea fields too, with no client token", async () => {
    render(<ContentListPage />);

    const gomb = await screen.findByRole("button", {
      name: "Ötlet feljegyzése",
    });
    fireEvent.click(gomb);

    await waitFor(() => {
      expect(screen.getByLabelText("Cím")).toBeTruthy();
    });
  });
});
