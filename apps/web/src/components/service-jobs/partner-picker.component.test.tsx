import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PartnerPicker } from "./partner-picker";

const worksheets = vi.hoisted(() => ({ selectablePartners: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: worksheets }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "owner@acropora.local",
    displayName: "Tulaj Tibor",
    nickname: null,
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const partners = [
  { customerId: "customer-1", name: "Biocentrum", partnerCode: "BIO" },
  { customerId: "customer-2", name: "Korallpark", partnerCode: "KOR" },
];

beforeEach(() => {
  auth.session = session;
  worksheets.selectablePartners.mockResolvedValue({ items: partners });
});

/**
 * A VALASZTO KET HIVASI MODJA, ES A KETTO KOZOTTI KULONBSEG NEM KOZOMBOS.
 *
 * A ket eredeti hivo (uj hibajegy, uj munkalap) MOST keletkezo sorhoz valaszt:
 * ott nincs korabbi ertek, es az ures opcio valasztasa nem muvelet. A
 * felhasznalo-szerkeszto viszont egy MEGLEVO kotest mutat, es ott mind a ketto
 * szamit -- kulonben a kepernyo azt allitana, hogy nincs kotes, holott van.
 */
describe("a partner-választó vezérelt alakja", () => {
  it("a MEGADOTT értéket mutatja kiválasztottként", async () => {
    /*
      MI PIROSIT: ha a `value` proppal is `defaultValue` maradna. A mezo akkor
      "Valassz partnert" felirattal allna egy MAR vevohoz kotott fiok lapjan --
      vagyis a kepernyo egy hamis allitast tenne, es aki mentene, csendben
      levenne a kotest.
    */
    render(
      <PartnerPicker id="p" value="customer-2" onPick={() => undefined} />,
    );
    await waitFor(() => screen.getByRole("option", { name: /Korallpark/ }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "customer-2",
    );
  });

  it("az ÜRES opció választása a törlés ágát hívja, nem a kiválasztásét", async () => {
    /*
      Az `onPick` csak akkor sul el, ha talalt partnert -- tehat az ures opcio
      korabban NEM csinalt semmit. Ahol a mezo egy meglevo kotest mutat, ott ez
      maga a muvelet: a kotes megszuntetese.

      MI PIROSIT: az `onClear` ag elhagyasa. Akkor a "sajat kollega" valasztas
      NEM tortenne meg, a mezo visszaugrana, es a felhasznalo nem tudna levenni
      egy kotest -- hibauzenet nelkul.
    */
    const onPick = vi.fn();
    const onClear = vi.fn();
    render(
      <PartnerPicker
        id="p"
        value="customer-1"
        onPick={onPick}
        onClear={onClear}
      />,
    );
    await waitFor(() => screen.getByRole("option", { name: /Biocentrum/ }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("a RÉGI, vezéreletlen alak változatlan marad", async () => {
    /*
      TESTVER-KONTROLL, ES EZ A LENYEG: a ket eredeti hivo `value` nelkul hiv.
      Ha a valtozas oket is vezereltte tenne, a mezo nem mozdulna a
      valasztasra -- egy uj hibajegy urlapjan a partnert nem lehetne
      kivalasztani.

      MI PIROSIT: ha a `value` akkor is rakerulne a mezore, amikor a hivo nem
      adta meg (peldaul ures sztringre esve).
    */
    const onPick = vi.fn();
    render(<PartnerPicker id="p" onPick={onPick} />);
    await waitFor(() => screen.getByRole("option", { name: /Biocentrum/ }));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "customer-1" } });
    expect(onPick).toHaveBeenCalledWith(partners[0]);
    expect(select.value).toBe("customer-1");
  });

  it("az ÜRES opció felirata a hívóé, ha ad neki", async () => {
    // A felhasznalo-szerkesztonel az ures ertek nem "valassz", hanem egy VALODI
    // allapot: sajat kollega. A ket kepernyo ugyanazt a mezot mas mondattal
    // olvassa, es a kulonbseg nem diszites.
    render(
      <PartnerPicker
        id="p"
        value=""
        emptyLabel="Nem partner: saját kolléga"
        onPick={() => undefined}
      />,
    );
    await waitFor(() =>
      screen.getByRole("option", { name: "Nem partner: saját kolléga" }),
    );
  });
});

/*
  A VÁLASZTÓ A KÖZÖS MEZŐT RAJZOLJA (UI-áttekintés, 3. csomag, 2026-11-03). Az új hibajegy űrlapján a
  Partner mező nyers, natív select volt (fekete keret, a böngésző nyila). MI PIROSÍT: ha a
  `pilot` vagy a `dusk` alak elveszíti a saját nyilát (a nyilat a közös elem rajzolja), vagy ha
  a választás nem jut el az `onPick`-ig. (Az üres opción induló állapotot ez a teszt rögzíti, de nem
  pirosítja: egy nem létező kezdőérték a betöltés előtt amúgy is az első opcióra esik.)
*/
describe.each(["dusk", "pilot"] as const)(
  "a partner-választó közös mezője (%s)",
  (variant) => {
    it("rajzol nyilat, és az üres opción indul", async () => {
      const { container } = render(
        <PartnerPicker id="p" variant={variant} onPick={() => undefined} />,
      );
      await waitFor(() => screen.getByRole("option", { name: /Korallpark/ }));
      expect(container.querySelector("svg")).not.toBeNull();
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "",
      );
    });

    it("a választás az onPick-et hívja a partnerrel", async () => {
      const onPick = vi.fn();
      render(<PartnerPicker id="p" variant={variant} onPick={onPick} />);
      await waitFor(() => screen.getByRole("option", { name: /Korallpark/ }));
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "customer-2" },
      });
      expect(onPick).toHaveBeenCalledWith(partners[1]);
    });
  },
);
