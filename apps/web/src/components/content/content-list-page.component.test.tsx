import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContentListPage } from "./content-list-page";

const api = vi.hoisted(() => ({
  waiting: vi.fn(),
  waitingOnMe: vi.fn(),
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
  api.waitingOnMe.mockReset().mockResolvedValue({ items: [], notCovered: [] });
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
    // AZ ALAPERTELMEZETT NEZET MOST A "MI VAR RAM", tehat a hibat ott kell
    // eloallitani. A regi alak a `waiting` hivast rontotta el, ami ebben a
    // nezetben el sem indul -- egy teszt, ami a rossz utat rontja el, zolden
    // hallgat arrol, amit merni akart.
    api.waitingOnMe.mockRejectedValue(new Error("hálózati hiba"));

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
  /**
   * A SZÁM A MONDATBAN ÁLL, nem külön jelvényben. Egy csupasz szám lehet
   * üzenetszám vagy értesítés is; csak a cím elolvasása után derülne ki, hogy
   * tételekről van szó -- pont az ellenkezője annak, hogy egy pillantás alatt
   * mondjon valamit.
   */
  it("counts the pieces waiting for an image and names the oldest", async () => {
    const sevenWeeksAgo = new Date(
      Date.now() - 49 * 24 * 60 * 60 * 1000,
    ).toISOString();
    api.waitingForImage.mockResolvedValue([
      item({ id: "regi", updatedAt: sevenWeeksAgo }),
      item({ id: "friss" }),
    ]);

    render(<ContentListPage />);

    /**
     * A CSÍKOT A SAJÁT MONDATÁN KERESZTÜL NÉZZÜK, nem a „7 hete" szövegre: az
     * a sorok kor-címkéjében IS ott áll, és egy tág keresés két elemet talál.
     * Az első futás pontosan ezt mondta meg -- a keresés volt tág, nem a
     * felület hibás.
     */
    await waitFor(() => expect(screen.getByText(/a legrégebbi/)).toBeTruthy());
    const strip = screen.getByText(/a legrégebbi/);
    expect(strip.textContent).toContain("2 tétel");
    expect(strip.textContent).toContain("7 hete");
  });

  /**
   * A „RÉGÓTA" SZÓ CSAK AKKOR ÁLL OTT, HA IGAZ.
   *
   * Egy két napja készült tételre kimondva hamis állítás lenne, és pont attól a
   * figyelmeztető erejétől fosztaná meg, amiért kiemelni kértük. Ugyanaz a
   * szabály, mint a lap többi jelzésénél: ami mindig ott áll, az nem jelent
   * semmit.
   *
   * A KÉT ESET EGYÜTT MÉR: külön-külön mindkettő igaz lehetne egy olyan
   * kódra is, ami sosem (vagy mindig) írja ki a szót.
   */
  it("only says 'régóta' when something really is old", async () => {
    api.waitingForImage.mockResolvedValue([item({ id: "friss" })]);
    const { unmount } = render(<ContentListPage />);
    await waitFor(() => expect(screen.getByText(/1 tétel/)).toBeTruthy());
    expect(screen.queryByText(/régóta/)).toBeNull();
    unmount();

    const longAgo = new Date(
      Date.now() - 49 * 24 * 60 * 60 * 1000,
    ).toISOString();
    api.waitingForImage.mockResolvedValue([
      item({ id: "regi", updatedAt: longAgo }),
    ]);
    render(<ContentListPage />);
    await waitFor(() => expect(screen.getByText(/régóta/)).toBeTruthy());
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
    expect(screen.queryByText(/tétel vár/)).toBeNull();
  });
});

describe("the view that opens by default", () => {
  /**
   * AMI RÁM VÁR, SZEREP-VÁLASZTÁS NÉLKÜL.
   *
   * Balázs panasza szó szerint az volt, hogy nem látja, mi vár rá. Egy
   * szerep-választó, amit előbb be kell állítani, ezt a kérdést egy lépéssel
   * odébb tolja -- és aki nem tudja, melyik szerepet keresse, üres listát lát.
   */
  it("asks what waits on me, not what waits on a role", async () => {
    render(<ContentListPage />);

    await waitFor(() => expect(api.waitingOnMe).toHaveBeenCalledTimes(1));
    // ÉS A SZEREP SZERINTI HÍVÁS EL SEM INDUL. E nélkül az állítás attól is zöld
    // lenne, hogy MINDKETTŐ lefut, és a felhasználó a rosszabbikat látja.
    expect(api.waiting).not.toHaveBeenCalled();
  });

  /**
   * A SZŰRÉS LÁTHATÓ, ÉS EGY KATTINTÁSSAL LEVEHETŐ. Aki nem tudja, hogy szűrt
   * listát néz, a hiányzó tételt nem létezőnek hiszi -- ezért a nézet ugyanabban
   * a választóban áll, mint a szerepek, nem külön dobozban.
   */
  it("keeps every other view one click away", async () => {
    render(<ContentListPage />);

    await waitFor(() => expect(api.waitingOnMe).toHaveBeenCalled());

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "approver" } });

    await waitFor(() => expect(api.waiting).toHaveBeenCalledTimes(1));
    expect(api.waiting.mock.calls[0]![1]).toBe("approver");
  });

  /**
   * ÉS AMIT A NÉZET NEM FED LE, AZ KI VAN ÍRVA.
   *
   * Ez ugyanaz az elv, mint a dokumentum-tároló állapotánál: a válasz mondja
   * meg, miről nem tud nyilatkozni. Egy „ami rám vár" lista, ami egy negyedét
   * kihagyja és hallgat róla, hamis megnyugvást ad.
   */
  it("says on screen which quarter it cannot cover", async () => {
    api.waitingOnMe.mockResolvedValue({
      items: [],
      notCovered: [
        {
          role: "sender",
          reason: "A kiküldésre kész tételek nem szerepelnek ebben a nézetben.",
        },
      ],
    });

    render(<ContentListPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/kiküldésre kész tételek nem szerepelnek/),
      ).toBeTruthy(),
    );
  });
});
