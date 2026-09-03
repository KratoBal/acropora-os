import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetEditorPage } from "./worksheet-editor-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const customers = vi.hoisted(() => ({ list: vi.fn() }));
const worksheets = vi.hoisted(() => ({
  departments: vi.fn(),
  createDepartment: vi.fn(),
  create: vi.fn(),
  updateDraft: vi.fn(),
  detail: vi.fn(),
  selectablePartners: vi.fn(),
  assignableUsers: vi.fn(),
}));
const jobs = vi.hoisted(() => ({ detail: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

/**
 * A `useSearchParams` IS KELL A DUPLABA, es nem kenyelmi kerdes: a felviteli lap
 * a cimbol veszi at a hibajegy azonositojat. Egy hianyzo hook nem "egy teszt
 * bukik", hanem a KOMPONENS dol el a renderelesnel -- ezert bukott elsore
 * mind a tizenharom allitas ebben a fajlban.
 */
const query = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => query.params,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: jobs }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: worksheets }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-sanyi",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

describe("WorksheetEditorPage partner picker", () => {
  beforeEach(() => {
    auth.session = session;
    customers.list.mockReset();
    worksheets.departments.mockReset().mockResolvedValue({ items: [] });
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({ items: [] });
    worksheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
    // A CIM ALAPHELYZETBEN URES: a felvitel tobbsege NEM jegy alol indul, es
    // egy ottfelejtett parameter minden mas allitast is elmozditana.
    query.params = new URLSearchParams();
    jobs.detail.mockReset().mockResolvedValue({
      id: "job-1",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
    });
  });

  /**
   * A worksheet is written for a service partner, not for somebody who bought
   * something in the webshop. The picker therefore reads the partner list.
   *
   * The customer endpoint is asserted as untouched in the same test: reading
   * both would also put the right names on screen, and would quietly bring
   * back the buyers this change exists to keep out.
   */
  it("offers service partners and leaves the buyers alone", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByRole("option", { name: "FANK - Fankó Kft." }),
    ).toBeTruthy();
    expect(customers.list).not.toHaveBeenCalled();
  });

  /**
   * The option's value is the id the worksheet stores, not the partner's own.
   * The two are different rows, and picking the wrong one would put the sheet
   * on a record that carries no worksheets -- it would fail on save, far from
   * the line that chose it.
   */
  it("carries the id the worksheet is stored against", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });

    render(<WorksheetEditorPage />);
    const option = (await screen.findByRole("option", {
      name: "FANK - Fankó Kft.",
    })) as HTMLOptionElement;

    expect(option.value).toBe("customer-42");
  });

  /**
   * An existing worksheet showed "Válassz partnert" where its partner's name
   * belongs, because the list is not loaded at all while editing and the
   * disabled Select had no option matching the assigned id.
   *
   * The name is asserted rather than the absence of the placeholder: the old
   * code rendered the placeholder AND no name, so only checking for a missing
   * option would have passed on a screen that shows nothing.
   */
  it("shows the partner of an existing worksheet without loading any list", async () => {
    worksheets.detail.mockResolvedValue({
      id: "ws-1",
      customer: {
        id: "customer-42",
        customerNumber: "V-0042",
        displayName: "Fankó Kft.",
        worksheetPartnerCode: "FANK",
      },
      department: { id: "dep-1", code: "BIO", name: "Bio", isActive: true },
      currentVersion: {
        subject: "Szivattyú csere",
        description: null,
        issueDate: null,
        fulfillmentDate: null,
        dueDate: null,
        lines: [],
      },
    });

    render(<WorksheetEditorPage worksheetId="ws-1" />);

    const selected = await screen.findByRole("option", { name: "Fankó Kft." });
    expect((selected as HTMLOptionElement).selected).toBe(true);
    expect(worksheets.selectablePartners).not.toHaveBeenCalled();
    expect(customers.list).not.toHaveBeenCalled();
  });

  /**
   * An empty dropdown reads as a broken screen. It is a rule instead: a
   * partner without the "Szerviz" tick or without an abbreviation is left out
   * on purpose, because a sheet written for one would refuse to close later.
   * The picker says so, and names the page that holds the missing field.
   */
  it("says why the picker is empty, and where the missing field is", async () => {
    worksheets.selectablePartners.mockResolvedValue({ items: [] });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByRole("option", {
        name: "Nincs választható szerviz partner",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/partner adatlapján/)).toBeTruthy();
  });

  it("keeps the ordinary placeholder when there is something to pick", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByRole("option", { name: "Válassz partnert" }),
    ).toBeTruthy();
    expect(screen.queryByText(/partner adatlapján/)).toBeNull();
  });

  /**
   * A list that never arrived is not an empty list. Saying "there is no
   * service partner" after a failed request would send somebody to fill in a
   * field that is already filled in.
   */
  it("does not blame the data when the list could not be loaded", async () => {
    worksheets.selectablePartners.mockRejectedValue(new Error("network"));

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByText("A partnerlista nem tölthető be."),
    ).toBeTruthy();
    expect(screen.queryByText(/partner adatlapján/)).toBeNull();
    expect(
      screen.queryByRole("option", {
        name: "Nincs választható szerviz partner",
      }),
    ).toBeNull();
  });
});

describe("WorksheetEditorPage assignees", () => {
  beforeEach(() => {
    auth.session = session;
    customers.list.mockReset();
    worksheets.departments.mockReset().mockResolvedValue({
      items: [
        {
          id: "department-1",
          parentId: null,
          code: "BIO",
          name: "Biodóm",
          isActive: true,
        },
      ],
    });
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.assignableUsers.mockReset().mockResolvedValue({
      items: [{ id: "user-sanyi", name: "Sanyi", role: "SERVICE" }],
    });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
    // A CIM ALAPHELYZETBEN URES: a felvitel tobbsege NEM jegy alol indul, es
    // egy ottfelejtett parameter minden mas allitast is elmozditana.
    query.params = new URLSearchParams();
    jobs.detail.mockReset().mockResolvedValue({
      id: "job-1",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
    });
  });

  /**
   * AZ IRODA NYIT LAPOT A SZERELŐNEK: a kiosztás a felvitel pillanatában
   * ismert. Külön lépésre bízva a felvivő azt hiszi, kiadta a munkát, közben a
   * lap senki listáján nem jelenik meg.
   */
  it("sends the chosen colleagues with the sheet, in one call", async () => {
    const user = userEvent.setup();
    render(<WorksheetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );
    await user.selectOptions(
      await screen.findByLabelText("Alegység"),
      "department-1",
    );
    await user.type(screen.getByLabelText("Tárgy"), "Havi karbantartás");
    await user.click(await screen.findByLabelText("Sanyi"));
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    expect(worksheets.create).toHaveBeenCalledTimes(1);
    expect(worksheets.create.mock.calls[0]?.[1]?.assigneeIds).toEqual([
      "user-sanyi",
    ]);
  });

  /**
   * A JEGY ALOL INDITOTT FELVITEL: A JEGY AZONOSITOJA A CIMBOL JON, A PARTNER A
   * SZERVERTOL.
   *
   * KET ALLITAS EGY ESETBEN, es mindketto kulon szamit: a `serviceJobId` eljut
   * a `create` hivasig (enelkul a lap jegy nelkul keletkezne, csendben), ES a
   * partnert a jegy adja (enelkul a felhasznalo mast valaszthatna, amit a
   * szerver utana visszautasitana).
   */
  it("a jegy alól indított felvitel a jegyet és a partnerét viszi", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.departments.mockResolvedValue({
      items: [
        {
          id: "department-1",
          name: "Biotóp",
          code: "BIO",
          parentId: null,
          isActive: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<WorksheetEditorPage />);

    await waitFor(() => expect(jobs.detail).toHaveBeenCalledTimes(1));
    expect(jobs.detail.mock.calls[0]?.[1]).toBe("job-1");

    await user.selectOptions(
      await screen.findByLabelText("Alegység"),
      "department-1",
    );
    await user.type(screen.getByLabelText("Tárgy"), "Szivattyú csere");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(worksheets.create).toHaveBeenCalledTimes(1));
    const kuldott = worksheets.create.mock.calls[0]?.[1];
    expect(kuldott?.serviceJobId).toBe("job-1");
    expect(kuldott?.customerId).toBe("customer-42");
  });

  /**
   * TESTVER-KONTROLL: JEGY NELKUL A MEZO EL SEM MEGY.
   *
   * A felvitel tobbsege nem jegy alol indul. Ha a `serviceJobId` ott is
   * megjelenne, a szerver egy nem letezo jegyre hivatkozna -- es az elso
   * allitas onmagaban akkor is zold lenne, ha a mezot MINDIG elkuldenenk.
   */
  it("jegy nélkül a serviceJobId nem megy el", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.departments.mockResolvedValue({
      items: [
        {
          id: "department-1",
          name: "Biotóp",
          code: "BIO",
          parentId: null,
          isActive: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<WorksheetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );
    await user.selectOptions(
      await screen.findByLabelText("Alegység"),
      "department-1",
    );
    await user.type(screen.getByLabelText("Tárgy"), "Havi karbantartás");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(worksheets.create).toHaveBeenCalledTimes(1));
    expect(jobs.detail).not.toHaveBeenCalled();
    expect("serviceJobId" in (worksheets.create.mock.calls[0]?.[1] ?? {})).toBe(
      false,
    );
  });

  /**
   * A KIOSZTÁS ELHAGYHATÓ. Egy lapot fel kell tudni vinni akkor is, ha még nem
   * dőlt el, ki megy ki -- a felelős a lap adatlapján később is megadható.
   */
  it("creates an unassigned sheet without complaining", async () => {
    const user = userEvent.setup();
    render(<WorksheetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );
    await user.selectOptions(
      await screen.findByLabelText("Alegység"),
      "department-1",
    );
    await user.type(screen.getByLabelText("Tárgy"), "Havi karbantartás");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    expect(worksheets.create.mock.calls[0]?.[1]?.assigneeIds).toEqual([]);
  });

  /**
   * ÜRES DOBOZ HELYETT MONDAT. Egy üres lista a "Felelősök" felirat alatt úgy
   * néz ki, mintha a betöltés akadt volna el, és a felvivő megvárná.
   */
  it("says out loud when there is nobody to assign", async () => {
    worksheets.assignableUsers.mockResolvedValue({ items: [] });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByText(
        "Nincs olyan kolléga, akire a lap kiosztható lenne.",
      ),
    ).toBeTruthy();
  });
});
/*
 * A HELYSZIN-FA A MUNKALAP-SZERKESZTON.
 *
 * A FIXTURA NEM DISZLET: ket kulonbozo AG alatt all ugyanaz a kod ES ugyanaz a
 * nev. Ez az ADR-010 szerint megengedett es termeszetes (a megkotes
 * `(customerId, parentId, code)`), tehat a lapos `kod - nev` alak ezt a ket
 * sort MEGKULONBOZTETHETETLENNE teszi. Ket TESTVER azonos koddal nem lenne jo
 * kontroll: azt a sema eleve tiltja, tehat elo sem allhat.
 */
const twoBranches = {
  items: [
    {
      id: "root-fank",
      parentId: null,
      code: "FAN",
      name: "Fankó telephely",
      isActive: true,
    },
    {
      id: "root-korall",
      parentId: null,
      code: "KOR",
      name: "Korallszirt",
      isActive: true,
    },
    {
      id: "bio-fank",
      parentId: "root-fank",
      code: "BIO",
      name: "Biodóm",
      isActive: true,
    },
    {
      id: "bio-korall",
      parentId: "root-korall",
      code: "BIO",
      name: "Biodóm",
      isActive: true,
    },
  ],
};

describe("WorksheetEditorPage site tree", () => {
  beforeEach(() => {
    auth.session = session;
    customers.list.mockReset();
    worksheets.departments.mockReset().mockResolvedValue(twoBranches);
    worksheets.createDepartment.mockReset().mockResolvedValue({
      id: "uj-helyszin",
      parentId: "bio-fank",
      code: "FNM",
      name: "Nagy főkamedence",
      isActive: true,
    });
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
    // A CIM ALAPHELYZETBEN URES: a felvitel tobbsege NEM jegy alol indul, es
    // egy ottfelejtett parameter minden mas allitast is elmozditana.
    query.params = new URLSearchParams();
    jobs.detail.mockReset().mockResolvedValue({
      id: "job-1",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
    });
  });

  /**
   * EZ A MEZO ADJA A MUNKALAPSZAM ELSO TAGJAT, tehat ket megkulonboztethetetlen
   * sor kozul rosszat valasztani nem szepseghiba: rossz szamot ad a lapnak.
   *
   * Az allitas a TELJES UTAT keri szamon, nem a behuzast: a behuzo szokozok
   * osszeolvadnak, es ket azonos nevu sor ugyanugy egyforma marad tolük.
   */
  it("tells two same-named units apart by their full path", async () => {
    const user = userEvent.setup();
    render(<WorksheetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );

    // A valasztora szukitve: a szulo-valaszto ugyanezeket a sorokat kinalja,
    // es egy nem szukitett kereses ket talalatot adna mindkettore.
    const picker = within(await screen.findByLabelText("Alegység"));
    expect(
      picker.getByRole("option", { name: "Fankó telephely / Biodóm (BIO)" }),
    ).toBeTruthy();
    expect(
      picker.getByRole("option", { name: "Korallszirt / Biodóm (BIO)" }),
    ).toBeTruthy();
  });

  /**
   * A FA NEM CSAK LATSZIK, HANEM EPITHETO IS. A szerver oldal a bevezetes ota
   * fogadja a `parentId` mezot (`worksheet.dto.ts`), a felulet viszont sokáig
   * nem kuldte: minden itt felvitt helyszin GYOKER szintre kerult.
   */
  it("hangs a new unit under the chosen parent", async () => {
    const user = userEvent.setup();
    render(<WorksheetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );
    await user.selectOptions(
      await screen.findByLabelText("Szülő helyszín"),
      "bio-fank",
    );
    await user.type(screen.getByLabelText("Új alegység kódja"), "fnm");
    await user.type(
      screen.getByLabelText("Új alegység neve"),
      "Nagy főkamedence",
    );
    await user.click(
      screen.getByRole("button", { name: "Alegység felvitele" }),
    );

    expect(worksheets.createDepartment).toHaveBeenCalledTimes(1);
    expect(worksheets.createDepartment.mock.calls[0]?.[2]).toEqual({
      parentId: "bio-fank",
      code: "FNM",
      name: "Nagy főkamedence",
    });
  });
});

/*
 * EGYIK VALASZTO SEM AJANL ARCHIVALT ALEGYSEGET.
 *
 * MA EZ IGAZ, DE VELETLENUL: a ket select UGYANABBOL az allapotbol dolgozik, es a
 * betoltes szuri az `isActive` mezot. Senki nem irt kulon szabalyt a szulo-valasztora --
 * egyszeruen nincs kulonvalasztva a ket lista.
 *
 * EZERT AZ ALLITAS KETTO, NEM EGY. Ma egyetlen rontas (a betoltesi szures elhagyasa)
 * MINDKETTOT pirosra valtja, es ez nem a keszlet hibaja, hanem PONT AZ A TENY, amit
 * rogzit. Ha valaki kesobb szetvalasztja a ket listat -- teljesen ertelmes okbol, mert
 * az egyikbe archivalt is kell --, a masik csendben elvesztene a szurest, es akkor CSAK
 * a hozza tartozo allitas pirosodik ki. Merve: egy olyan rontas, ami csak a
 * szulo-valasztot koti a szuretlen listahoz, pontosan egy allitast dont pirosra.
 */
describe("WorksheetEditorPage: archived units in the two pickers", () => {
  const active = {
    id: "unit-bio",
    parentId: null,
    code: "BIO",
    name: "Biodóm",
    isActive: true,
  };
  const archived = {
    id: "unit-regi",
    parentId: null,
    code: "REG",
    name: "Régi szárny",
    isActive: false,
  };

  beforeEach(() => {
    auth.session = session;
    customers.list.mockReset();
    worksheets.departments
      .mockReset()
      .mockResolvedValue({ items: [active, archived] });
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
    // A CIM ALAPHELYZETBEN URES: a felvitel tobbsege NEM jegy alol indul, es
    // egy ottfelejtett parameter minden mas allitast is elmozditana.
    query.params = new URLSearchParams();
    jobs.detail.mockReset().mockResolvedValue({
      id: "job-1",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
    });
  });

  async function optionsOf(label: string): Promise<string[]> {
    const picker = await screen.findByLabelText(label);
    return Array.from(
      picker.querySelectorAll("option"),
      (option) => option.textContent ?? "",
    );
  }

  /** A lap alegysege: ide uj MUNKA indul, tehat archivalt nem valaszthato. */
  it("keeps an archived unit out of the sheet's own picker", async () => {
    render(<WorksheetEditorPage />);
    await userEvent
      .setup()
      .selectOptions(await screen.findByLabelText("Partner"), "customer-42");

    const offered = await optionsOf("Alegység");
    expect(offered.some((text) => text.includes("Biodóm"))).toBe(true);
    expect(offered.some((text) => text.includes("Régi szárny"))).toBe(false);
  });

  /**
   * A SZULO-VALASZTO: ide uj ALEGYSEG kerul. Egy archivalt ag ala tett, aktiv
   * alegyseg a lap valasztojaban MEGJELENNE -- vagyis az archivalt ag egy
   * gyereken keresztul csendben visszaterne a munkaba.
   */
  it("keeps an archived unit out of the parent picker", async () => {
    render(<WorksheetEditorPage />);
    await userEvent
      .setup()
      .selectOptions(await screen.findByLabelText("Partner"), "customer-42");

    const offered = await optionsOf("Szülő helyszín");
    expect(offered.some((text) => text.includes("Biodóm"))).toBe(true);
    expect(offered.some((text) => text.includes("Régi szárny"))).toBe(false);
  });
});
