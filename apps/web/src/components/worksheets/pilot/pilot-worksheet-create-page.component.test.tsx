import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
import { PilotWorksheetCreatePage } from "./pilot-worksheet-create-page";

/**
 * A TESZTEK ÁTKÖLTÖZTEK A RÉGI `worksheet-editor-page.component.test.tsx`
 * FELVITELI ÁGÁBÓL (acrobot kérése, 2026-09-25, msg 23809), miután a
 * `/szerkesztes` útvonal átállt a `pilot-worksheet-editor-page.tsx`-re, és a
 * régi `worksheet-editor-page.tsx` innentől HOLT KÓD -- de a felvitel (`/uj`)
 * logikáját szó szerint ez a `PilotWorksheetCreatePage` futtatja, és eddig
 * NEM VOLT SAJÁT TESZTJE. A teljes átköltöztetési táblázat a PR törzsében áll.
 *
 * MINDEN ÁLLÍTÁS AZ EREDETI VISELKEDÉST MÉRI, a mai (pilot) jelölőkhöz
 * igazítva -- lásd a fájl alján a KÉT VALÓDI ELTÉRÉST: a "Mégsem" felirat ma
 * "Mégse", és az új alegység mezői ma egy "+ Új alegység hozzáadása"
 * hivatkozás mögött állnak, nem mindig látszanak.
 */

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
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
/**
 * AZ ESZKOZ-LISTA MOCKJA KELL, UGYANAZ AZ OK, MINT A REGI FAJLBAN: a
 * `JobAssetPicker` csak akkor hiv, ha van alegyseg, es a jegybol nyitott
 * lapon az MAR ELOTOLTVE all.
 */
const assets = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

/**
 * A `useSearchParams` A CIMBOL VESZI A HIBAJEGY AZONOSITOJAT -- ugyanaz a
 * mintaz, mint a regi fajlban, mert a `PilotWorksheetCreatePage` is ezt
 * hasznalja a `?hibajegy=` parameterhez.
 */
const query = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => query.params,
  usePathname: () => "/szerviz/munkalapok/uj",
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: jobs }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: worksheets }));
vi.mock("@/lib/api/assets", () => ({ assetsApi: assets }));

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

/**
 * AZ ÚJ ALEGYSÉG MEZŐI MA EGY HIVATKOZÁS MÖGÖTT ÁLLNAK -- a régi lapon
 * ("Szülő helyszín" stb.) mindig látszottak. Ez a segéd nyitja ki, ahol a
 * régi teszt közvetlenül a mezőkhöz nyúlt.
 */
async function nyisdKiAzUjAlegysegett(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(
    await screen.findByRole("button", { name: "+ Új alegység hozzáadása" }),
  );
}

describe("PilotWorksheetCreatePage partner picker", () => {
  beforeEach(() => {
    auth.session = session;
    worksheets.departments.mockReset().mockResolvedValue({ items: [] });
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({ items: [] });
    worksheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
    // A CIM ALAPHELYZETBEN URES: a felvitel tobbsege NEM jegy alol indul.
    query.params = new URLSearchParams();
    assets.list.mockReset().mockResolvedValue({
      items: [
        { id: "asset-1", assetNumber: "ESZ-0001", name: "Szivattyú" },
        { id: "asset-2", assetNumber: "ESZ-0002", name: "Szűrő" },
      ],
      total: 2,
    });
    jobs.detail.mockReset().mockResolvedValue({
      id: "job-1",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
      departmentId: null,
      departmentName: null,
      assets: [],
    });
  });

  it("offers service partners and leaves the buyers alone", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });

    render(<PilotWorksheetCreatePage />);

    expect(
      await screen.findByRole("option", { name: "FANK - Fankó Kft." }),
    ).toBeTruthy();
  });

  it("carries the id the worksheet is stored against", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });

    render(<PilotWorksheetCreatePage />);
    const option = (await screen.findByRole("option", {
      name: "FANK - Fankó Kft.",
    })) as HTMLOptionElement;

    expect(option.value).toBe("customer-42");
  });

  it("says why the picker is empty, and where the missing field is", async () => {
    worksheets.selectablePartners.mockResolvedValue({ items: [] });

    render(<PilotWorksheetCreatePage />);

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

    render(<PilotWorksheetCreatePage />);

    expect(
      await screen.findByRole("option", { name: "Válassz partnert…" }),
    ).toBeTruthy();
    expect(screen.queryByText(/partner adatlapján/)).toBeNull();
  });

  it("does not blame the data when the list could not be loaded", async () => {
    worksheets.selectablePartners.mockRejectedValue(new Error("network"));

    render(<PilotWorksheetCreatePage />);

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

describe("PilotWorksheetCreatePage assignees", () => {
  beforeEach(() => {
    auth.session = session;
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
    query.params = new URLSearchParams();
    jobs.detail.mockReset().mockResolvedValue({
      id: "job-1",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
    });
  });

  it("sends the chosen colleagues with the sheet, in one call", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

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
    render(<PilotWorksheetCreatePage />);

    await waitFor(() => expect(jobs.detail).toHaveBeenCalledTimes(1));
    expect(jobs.detail.mock.calls[0]?.[1]).toBe("job-1");

    const alegyseg = await screen.findByLabelText("Alegység");
    await waitFor(() =>
      expect(
        within(alegyseg).getByRole("option", { name: /Biotóp/ }),
      ).toBeTruthy(),
    );
    await user.selectOptions(alegyseg, "department-1");
    await user.type(screen.getByLabelText("Tárgy"), "Szivattyú csere");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(worksheets.create).toHaveBeenCalledTimes(1));
    const kuldott = worksheets.create.mock.calls[0]?.[1];
    expect(kuldott?.serviceJobId).toBe("job-1");
    expect(kuldott?.customerId).toBe("customer-42");
  });

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
    render(<PilotWorksheetCreatePage />);

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

  it("üres alegység-listánál tükör-soros partnernél a felvitelre mutat", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.departments.mockResolvedValue({ items: [] });
    render(<PilotWorksheetCreatePage />);

    expect(
      await screen.findByText(/Ehhez a partnerhez még nincs alegység/),
    ).toBeTruthy();
  });

  it("üres alegység-listánál nem-tükör partnernél a jegyre mutat", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockResolvedValue({
      id: "job-1",
      customerId: "regi-vevo",
      customerName: "Régi Vevő",
    });
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.departments.mockResolvedValue({ items: [] });
    render(<PilotWorksheetCreatePage />);

    expect(
      await screen.findByText(/a partnere nem szerviz partnerként van felvéve/),
    ).toBeTruthy();
  });

  function jegyHelyszinnel(
    departmentId: string | null,
    name: string | null,
    assets: { id: string; assetId: string }[] = [],
  ) {
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockResolvedValue({
      id: "job-1",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
      departmentId,
      departmentName: name,
      assets: assets.map((link) => ({
        ...link,
        assetNumber: "ESZ-0001",
        assetName: "Szivattyú",
        attachedAt: "2026-09-15T08:00:00.000Z",
      })),
    });
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
        {
          id: "department-2",
          name: "Fókamedence",
          code: "FOK",
          parentId: null,
          isActive: true,
        },
      ],
    });
  }

  it("a jegy helyszíne előtöltve áll az alegység-választóban", async () => {
    jegyHelyszinnel("department-1", "Biotóp");
    render(<PilotWorksheetCreatePage />);

    const alegyseg = (await screen.findByLabelText(
      "Alegység",
    )) as HTMLSelectElement;
    await waitFor(() => expect(alegyseg.value).toBe("department-1"));
  });

  it("helyszín nélküli jegynél a választó üres marad", async () => {
    jegyHelyszinnel(null, null);
    render(<PilotWorksheetCreatePage />);

    const alegyseg = (await screen.findByLabelText(
      "Alegység",
    )) as HTMLSelectElement;
    await waitFor(() =>
      expect(
        within(alegyseg).getByRole("option", { name: /Biotóp/ }),
      ).toBeTruthy(),
    );
    expect(alegyseg.value).toBe("");
  });

  it("az előtöltött helyszín felülírható, és a felvitel a VÁLASZTOTTAT viszi", async () => {
    jegyHelyszinnel("department-1", "Biotóp");
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

    const alegyseg = (await screen.findByLabelText(
      "Alegység",
    )) as HTMLSelectElement;
    await waitFor(() => expect(alegyseg.value).toBe("department-1"));
    expect(alegyseg.disabled).toBe(false);

    await user.selectOptions(alegyseg, "department-2");
    await user.type(screen.getByLabelText("Tárgy"), "Szivattyú csere");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(worksheets.create).toHaveBeenCalledTimes(1));
    expect(worksheets.create.mock.calls[0]?.[1]).toMatchObject({
      departmentId: "department-2",
    });
  });

  it("archivált jegy-helyszínt megnevez, és a mentést sem engedi vele", async () => {
    jegyHelyszinnel("archivalt-egyseg", "Régi medence");
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

    expect(
      await screen.findByText(
        /A hibajegy helyszíne \(Régi medence\) archivált/,
      ),
    ).toBeTruthy();

    const mentes = screen.getByRole("button", {
      name: "Mentés",
    }) as HTMLButtonElement;
    await user.type(screen.getByLabelText("Tárgy"), "Szivattyú csere");
    await waitFor(() => expect(mentes.disabled).toBe(true));
    expect(worksheets.create).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Alegység"), "department-1");
    await waitFor(() => expect(mentes.disabled).toBe(false));
  });

  it("a jegy eszközei előtöltve állnak, és a felvitel viszi őket", async () => {
    jegyHelyszinnel("department-1", "Biotóp", [
      { id: "link-1", assetId: "asset-1" },
    ]);
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

    const eszkoz = await screen.findByLabelText(/ESZ-0001/);
    await waitFor(() =>
      expect((eszkoz as HTMLInputElement).checked).toBe(true),
    );

    await user.type(screen.getByLabelText("Tárgy"), "Szivattyú csere");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(worksheets.create).toHaveBeenCalledTimes(1));
    expect(worksheets.create.mock.calls[0]?.[1]).toMatchObject({
      assetIds: ["asset-1"],
    });
  });

  it("eszköz nélküli jegynél üres listával indul", async () => {
    jegyHelyszinnel("department-1", "Biotóp", []);
    render(<PilotWorksheetCreatePage />);

    const eszkoz = await screen.findByLabelText(/ESZ-0001/);
    expect((eszkoz as HTMLInputElement).checked).toBe(false);
  });

  it("az örökölt eszköz levehető, és másik felvehető", async () => {
    jegyHelyszinnel("department-1", "Biotóp", [
      { id: "link-1", assetId: "asset-1" },
    ]);
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

    const orokolt = (await screen.findByLabelText(
      /ESZ-0001/,
    )) as HTMLInputElement;
    await waitFor(() => expect(orokolt.checked).toBe(true));

    await user.click(orokolt);
    await user.click(screen.getByLabelText(/ESZ-0002/));
    await user.type(screen.getByLabelText("Tárgy"), "Szivattyú csere");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(worksheets.create).toHaveBeenCalledTimes(1));
    expect(worksheets.create.mock.calls[0]?.[1]).toMatchObject({
      assetIds: ["asset-2"],
    });
  });

  it("üres alegység-listánál a helyszínes jegy is a partner-mondatot kapja", async () => {
    jegyHelyszinnel("department-1", "Biotóp");
    worksheets.departments.mockResolvedValue({ items: [] });
    render(<PilotWorksheetCreatePage />);

    expect(
      await screen.findByText(/Ehhez a partnerhez még nincs alegység/),
    ).toBeTruthy();
    expect(screen.queryByText(/archivált/)).toBeNull();
  });

  it("alegységgel a rendes leírás áll", async () => {
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
    render(<PilotWorksheetCreatePage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );

    expect(
      await screen.findByText("A munkalapszám első tagja is ebből lesz."),
    ).toBeTruthy();
    expect(screen.queryByText(/még nincs alegység/)).toBeNull();
  });

  it("creates an unassigned sheet without complaining", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

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

  it("says out loud when there is nobody to assign", async () => {
    worksheets.assignableUsers.mockResolvedValue({ items: [] });

    render(<PilotWorksheetCreatePage />);

    expect(
      await screen.findByText(
        "Nincs olyan kolléga, akire a lap kiosztható lenne.",
      ),
    ).toBeTruthy();
  });
});

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

describe("PilotWorksheetCreatePage site tree", () => {
  beforeEach(() => {
    auth.session = session;
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
    query.params = new URLSearchParams();
    jobs.detail.mockReset().mockResolvedValue({
      id: "job-1",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
    });
  });

  it("tells two same-named units apart by their full path", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );

    const picker = within(await screen.findByLabelText("Alegység"));
    expect(
      picker.getByRole("option", { name: "Fankó telephely / Biodóm (BIO)" }),
    ).toBeTruthy();
    expect(
      picker.getByRole("option", { name: "Korallszirt / Biodóm (BIO)" }),
    ).toBeTruthy();
  });

  /**
   * A FA NEM CSAK LATSZIK, HANEM EPITHETO IS -- de az uj alegyseg mezoi ma
   * egy hivatkozas mogott allnak (a regi lapon mindig lathatoak voltak).
   */
  it("hangs a new unit under the chosen parent", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );
    await nyisdKiAzUjAlegysegett(user);
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

describe("PilotWorksheetCreatePage: archived units in the two pickers", () => {
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

  it("keeps an archived unit out of the sheet's own picker", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);
    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );

    const offered = await optionsOf("Alegység");
    expect(offered.some((text) => text.includes("Biodóm"))).toBe(true);
    expect(offered.some((text) => text.includes("Régi szárny"))).toBe(false);
  });

  it("keeps an archived unit out of the parent picker", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);
    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );
    await nyisdKiAzUjAlegysegett(user);

    const offered = await optionsOf("Szülő helyszín");
    expect(offered.some((text) => text.includes("Biodóm"))).toBe(true);
    expect(offered.some((text) => text.includes("Régi szárny"))).toBe(false);
  });
});

/**
 * A KIÚT AZ ŰRLAP VÉGÉN. Ma "Mégse" a felirat (a régi lapon "Mégsem" volt) --
 * a `useReturnTo("/szerviz/munkalapok")` tartalék célja szolgáltatja a hrefet,
 * ugyanúgy, mint a régi, kézzel írt "/szerviz/munkalapok" a felvitel ágon.
 */
describe("PilotWorksheetCreatePage kiút", () => {
  beforeEach(() => {
    auth.session = session;
    query.params = new URLSearchParams();
    worksheets.departments.mockReset().mockResolvedValue({ items: [] });
    worksheets.selectablePartners.mockReset().mockResolvedValue({ items: [] });
    worksheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    worksheets.detail.mockReset();
    assets.list.mockReset().mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
    });
  });

  it("új munkalapnál a mentés melletti kiút a listához visz", async () => {
    render(<PilotWorksheetCreatePage />);

    const megse = await screen.findByRole("link", { name: "Mégse" });
    expect(megse.getAttribute("href")).toBe("/szerviz/munkalapok");
  });
});

/**
 * AZ URLAP EGYETLEN ALLAPOTBA TUD KERULNI -- lasd a regi fajl azonos
 * fejlecet arrol, miert csak EGY allitas a helyes szam itt.
 */
describe("PilotWorksheetCreatePage kapcsolat nélkül", () => {
  beforeEach(() => {
    auth.session = session;
    worksheets.departments.mockReset().mockResolvedValue({ items: [] });
    worksheets.selectablePartners.mockReset().mockResolvedValue({ items: [] });
    worksheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    setOnLine(false);
  });

  afterEach(() => setOnLine(true));

  it("az űrlapon kimondja, hogy a mentés nem fog sikerülni", async () => {
    render(<PilotWorksheetCreatePage />);

    expect(await savotMond("form")).toBeTruthy();
  });
});
