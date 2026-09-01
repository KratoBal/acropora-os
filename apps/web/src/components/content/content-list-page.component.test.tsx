import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContentListPage } from "./content-list-page";

const api = vi.hoisted(() => ({
  waiting: vi.fn(),
  waitingForImage: vi.fn(),
}));

vi.mock("@/lib/api/content", () => ({ contentApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: {
        id: "user-1",
        email: "b@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        permissions: ["content.view"],
      },
    },
  }),
}));

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  title: "Minta cím",
  channel: "FACEBOOK_POST",
  state: "READY_TO_SEND",
  imageRequired: true,
  imageAttachedAt: null,
  authorId: null,
  reviewerId: null,
  plannedFor: null,
  scheduledFor: null,
  scheduleAnchoredAt: null,
  sentAt: null,
  externalUrl: null,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  api.waiting.mockReset().mockResolvedValue([]);
  api.waitingForImage.mockReset().mockResolvedValue([]);
});

describe("what the content list says when the load fails", () => {
  /**
   * EZ A LEGFONTOSABB ÁLLÍTÁS EBBEN A FÁJLBAN, és egy valódi hibából
   * származik, amit picasso talált 2026-09-01-én.
   *
   * Hiba esetén a lekérdezés `null`-t hagyott, az üresre esett, és a felület
   * azt állította, hogy „Semmi nem vár képre" -- holott a valóság az, hogy NEM
   * TUDJUK, mi vár. **Egy hibát SIKERKÉNT jelenítettünk meg:** aki ránéz,
   * megnyugszik és elmegy.
   *
   * Három állapot van, nem kettő: van adat, nincs adat, és nem tudjuk. Ez az
   * állítás a harmadikat méri.
   */
  it("does not claim there is nothing to do", async () => {
    api.waitingForImage.mockRejectedValue(new Error("hálózati hiba"));

    render(<ContentListPage />);

    await waitFor(() =>
      expect(screen.getByText("A lista nem tölthető be")).toBeTruthy(),
    );
    expect(screen.queryByText("Semmi nem vár képre.")).toBeNull();
    expect(screen.queryByText("Ebben a nézetben most nincs tétel.")).toBeNull();
  });

  /**
   * SIKERES, DE ÜRES BETÖLTÉSNÉL VISZONT KI KELL MONDANI, hogy nincs teendő.
   * E nélkül a javítás átcsapna a másik hibába: a felhasználó nem tudná
   * megkülönböztetni az üres sort attól, hogy az oldal be sem töltött.
   */
  it("still says so when the list really is empty", async () => {
    render(<ContentListPage />);

    await waitFor(() =>
      expect(screen.getByText("Semmi nem vár képre.")).toBeTruthy(),
    );
    expect(screen.queryByText("A lista nem tölthető be")).toBeNull();
  });

  /**
   * A HIBAÜZENET LEGFELÜL ÁLL, a szekciók előtt. Az átrendezés után lejjebb
   * csúszott volna, mint ahol korábban volt -- egy hiba, amit görgetni kell,
   * ugyanolyan láthatatlan, mint amelyik nincs is ott.
   */
  it("puts the error above the sections", async () => {
    api.waiting.mockRejectedValue(new Error("hálózati hiba"));

    const { container } = render(<ContentListPage />);

    await waitFor(() =>
      expect(screen.getByText("A lista nem tölthető be")).toBeTruthy(),
    );
    const alert = screen.getByText("A lista nem tölthető be");
    const selector = screen.getByText("Kinek a szemével");
    expect(
      alert.compareDocumentPosition(selector) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container).toBeTruthy();
  });
});

describe("what the summary strip shows", () => {
  it("counts the pieces waiting for an image and names the oldest", async () => {
    const sevenWeeksAgo = new Date(
      Date.now() - 49 * 24 * 60 * 60 * 1000,
    ).toISOString();
    api.waitingForImage.mockResolvedValue([
      item({ id: "regi", updatedAt: sevenWeeksAgo }),
      item({ id: "friss" }),
    ]);

    render(<ContentListPage />);

    await waitFor(() =>
      expect(screen.getByText("a legrégebbi: 7 hete")).toBeTruthy(),
    );
  });

  /**
   * ÜRES LISTÁRA NEM JELENIK MEG. Egy „0 tétel vár képre" csík minden nap ott
   * állna, és pár nap alatt megtanítaná az olvasót, hogy ne nézzen oda.
   */
  it("stays away when nothing waits for an image", async () => {
    render(<ContentListPage />);

    await waitFor(() =>
      expect(screen.getByText("Semmi nem vár képre.")).toBeTruthy(),
    );
    expect(screen.queryByText(/a legrégebbi:/)).toBeNull();
  });
});
