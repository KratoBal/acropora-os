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
  history: [],
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
  claims: [],
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

describe("the state log (T5.1)", () => {
  /*
    WHAT TURNS THIS RED. The log not shown, or shown newest first (the order it happened is the story); the actor missing
    from the line; an item with no log shown as if it had never moved (the missing past must be SAID, not implied); a sent
    item with no "where and when" line, or a not-sent one with it.
  */
  const event = (over: Record<string, unknown>) => ({
    id: "e",
    fromState: "DRAFTING",
    toState: "AWAITING_REVIEW",
    actorUserId: "u-1",
    actorName: "Korall",
    note: null,
    createdAt: "2026-11-04T08:12:00.000Z",
    ...over,
  });

  it("lists who moved the item from where to where, oldest first, with the note", async () => {
    api.detail.mockResolvedValue(
      detail({
        history: [
          event({ id: "e1", fromState: null, toState: "DRAFTING" }),
          event({
            id: "e2",
            fromState: "AWAITING_REVIEW",
            toState: "AWAITING_REVISION",
            actorName: "Luca",
            note: "az ár hiányzik",
            createdAt: "2026-11-04T13:30:00.000Z",
          }),
        ],
      }),
    );
    render(<ContentDetailPanel id="c1" />);

    const first = await screen.findByText(
      /Korall: létrehozta \(vázlat készül\)/,
    );
    const second = screen.getByText(
      /Luca: lektorálásra vár → javításra vár, „az ár hiányzik”/,
    );
    expect(screen.getByText(/Ki, mikor, mit csinált \(2\)/)).toBeTruthy();
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says that a log is missing for an item from before the log, instead of showing nothing", async () => {
    render(<ContentDetailPanel id="c1" />);

    await waitFor(() =>
      expect(
        screen.getByText(/napló bevezetése előtti időből nincs bejegyzés/),
      ).toBeTruthy(),
    );
  });

  it("a sent item says where and when, a not-sent one has no such line", async () => {
    api.detail.mockResolvedValue(
      detail({
        state: "SENT",
        channel: "FACEBOOK_POST",
        history: [
          event({
            fromState: "READY_TO_SEND",
            toState: "SENT",
            createdAt: "2026-11-05T09:00:00.000Z",
          }),
        ],
      }),
    );
    const { unmount } = render(<ContentDetailPanel id="c1" />);
    await waitFor(() =>
      expect(screen.getByText(/Kiment: .*Facebook poszt/)).toBeTruthy(),
    );
    unmount();

    api.detail.mockResolvedValue(detail());
    render(<ContentDetailPanel id="c1" />);
    await waitFor(() =>
      expect(screen.getByText(/Az első bekezdés/)).toBeTruthy(),
    );
    expect(screen.queryByText(/Kiment:/)).toBeNull();
  });
});

describe("the manufacturer claims the item stands on (T5.3)", () => {
  it("shows each claim with its marking, what it allows and why, before approval", async () => {
    api.detail.mockResolvedValue(
      detail({
        claims: [
          {
            id: "a1",
            productName: "Teszt adalék",
            claimType: "DOSING",
            claimText: "Napi 5 ml 100 literenként.",
            status: "UNVERIFIED",
            output: {
              mode: "DRAFT_ONLY",
              attribution: "a gyártó szerint",
              reasons: ["UNVERIFIED"],
            },
          },
        ],
      }),
    );
    render(<ContentDetailPanel id="c1" />);
    const row = await screen.findByTestId("content-claim-a1");
    expect(row.textContent).toContain("Teszt adalék");
    expect(row.textContent).toContain("Adagolás");
    expect(row.textContent).toContain("Csak vázlatba");
    expect(row.textContent).toContain("(a gyártó szerint)");
    expect(row.textContent).toContain("még senki nem ellenőrizte");
  });

  it("no section when the item stands on no claim", async () => {
    render(<ContentDetailPanel id="c1" />);
    await screen.findByText("A szöveg");
    expect(screen.queryByText(/Gyártói állítások/)).toBeNull();
  });
});
