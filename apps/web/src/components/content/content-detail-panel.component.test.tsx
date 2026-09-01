import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContentDetailPanel } from "./content-detail-panel";

const api = vi.hoisted(() => ({ detail: vi.fn() }));

vi.mock("@/lib/api/content", () => ({ contentApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: "OWNER" },
    },
  }),
}));

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  title: "Minta cím",
  channel: "FACEBOOK_POST",
  state: "AWAITING_APPROVAL",
  body: "Az első bekezdés.\n\nA második bekezdés.",
  comments: [],
  imageRequired: false,
  imageAttachedAt: null,
  authorId: null,
  reviewerId: null,
  plannedFor: null,
  scheduledFor: null,
  scheduleAnchoredAt: null,
  sentAt: null,
  externalUrl: null,
  updatedAt: new Date().toISOString(),
  moves: [],
  blockers: { waitsOn: { on: "approver" }, waitsForImage: false },
  ...overrides,
});

beforeEach(() => {
  api.detail.mockReset().mockResolvedValue(detail());
});

describe("what a decision needs in front of it", () => {
  /**
   * A SZÖVEG. Ez a panel azért létezik: mérve 2026-09-01-én, a felület egyetlen
   * hívása sem kérte le a részletet, tehát aki jóváhagyott, nem tudta
   * elolvasni, MIT hagy jóvá. A képesség megvolt, csak nem volt bekötve.
   */
  it("shows the text the approver has to say yes to", async () => {
    render(<ContentDetailPanel id="c1" />);

    await waitFor(() =>
      expect(screen.getByText(/Az első bekezdés/)).toBeTruthy(),
    );
  });

  /**
   * ÉS A BESZÉLGETÉS, IDŐRENDBEN. A visszaküldés felvetése hozzászólásként
   * születik meg, azzal az indokkal, hogy „ott álljon, ahol a válasz is lesz" --
   * ez az a hely.
   */
  it("shows the remarks, oldest first, so a reply has something to answer", async () => {
    api.detail.mockResolvedValue(
      detail({
        comments: [
          {
            id: "k1",
            authorId: "user-2",
            body: "a második bekezdés két állítást kever",
            createdAt: "2026-09-01T10:00:00.000Z",
          },
          {
            id: "k2",
            authorId: "user-1",
            body: "szétszedtem, kész",
            createdAt: "2026-09-01T11:00:00.000Z",
          },
        ],
      }),
    );

    render(<ContentDetailPanel id="c1" />);

    await waitFor(() =>
      expect(screen.getByText(/két állítást kever/)).toBeTruthy(),
    );
    expect(screen.getByText(/szétszedtem/)).toBeTruthy();

    // A SORREND SZÁMÍT: a felvetés áll elöl, a válasz utána. Fordítva a
    // beszélgetés olvashatatlan, és a lista sorrendje az EGYETLEN, ami ma
    // megmondja, mi mire válasz -- szál-szerkezet nincs.
    const remark = screen.getByText(/két állítást kever/);
    const reply = screen.getByText(/szétszedtem/);
    expect(
      remark.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /**
   * A HIBA NEM ÜRES TARTALOMKÉNT JELENIK MEG.
   *
   * Három állapot van, nem kettő: van adat, nincs adat, és nem tudjuk. Ugyanaz
   * a szabály, mint a listánál, és ugyanabból a hibából: egy sikerként
   * megjelenített hiba megnyugtat, és aki ránéz, elmegy.
   */
  it("says the load failed instead of showing an empty piece", async () => {
    api.detail.mockRejectedValue(new Error("hálózati hiba"));

    render(<ContentDetailPanel id="c1" />);

    await waitFor(() =>
      expect(screen.getByText("A tétel nem tölthető be")).toBeTruthy(),
    );
    // ÉS NEM ÁLLÍTJA, HOGY NINCS HOZZÁSZÓLÁS. E nélkül az állítás attól is zöld
    // lenne, hogy a hibaüzenet MELLETT ott áll az üres-állapot szövege is.
    expect(screen.queryByText("Még nincs hozzászólás.")).toBeNull();
  });

  /**
   * ÜRES SZÖVEG NEM UGYANAZ, MINT HIÁNYZÓ SZÖVEG. Egy tétel, aminek még nincs
   * megfogalmazva a törzse, létező állapot (ötlet), és a panel ezt mondja ki --
   * nem hagy üres helyet, amiről nem derül ki, betöltött-e.
   */
  it("names an empty body instead of leaving a blank space", async () => {
    api.detail.mockResolvedValue(detail({ body: null }));

    render(<ContentDetailPanel id="c1" />);

    await waitFor(() =>
      expect(screen.getByText(/még nincs szöveg/)).toBeTruthy(),
    );
  });
});
