import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answered } from "@/test/answered";
import { listedSelect } from "@/test/listed-option";

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
 * "Mégse", és az új alegység mezői ma egy "+ Új helyszín hozzáadása"
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
    await screen.findByRole("button", { name: "+ Új helyszín hozzáadása" }),
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

  it("the asset hint under Érintett eszközök is the shared small grey hint, not italic", async () => {
    worksheets.selectablePartners.mockResolvedValue({ items: [] });
    render(<PilotWorksheetCreatePage />);
    // Picasso 3.7: a disabled field saying what it waits for, the why as the small grey help (not italic)
    const waiting = await screen.findByRole("option", {
      name: "Előbb válassz helyszínt",
    });
    expect(waiting.closest("select")).toBeDisabled();
    const hint = screen.getByText("Az eszközök a helyszín részfájából jönnek.");
    expect(hint.className).toBe("text-xs text-pilot-grey-400");
    expect(hint.className).not.toContain("italic");
    // the location select is disabled too, and says what it waits for
    expect(
      screen.getByRole("option", { name: "Előbb válassz partnert" }),
    ).toBeTruthy();
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
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );
    await user.selectOptions(
      await listedSelect("Helyszín", "department-1"),
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

    const alegyseg = await screen.findByLabelText("Helyszín");
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
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );
    await user.selectOptions(
      await listedSelect("Helyszín", "department-1"),
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
      await screen.findByText(/Ehhez a partnerhez még nincs helyszín/),
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

  /*
    A KARBANTARTÁSBÓL NYITOTT MUNKALAP-ŰRLAP A KARBANTARTÁS SZAVAIT HASZNÁLJA (Balázs 2026-11-18: "a karbantartásnak semmi köze a hibajegyekhez"; stage-végigjárás, acrobot 56068): a
    fejléc "Hibajegy: KT-2026-004" volt, az eszköz-szöveg "A hibajegyből nyitott lap a jegy eszközeivel indul". MI PIROSÍT: ha a karbantartási lapról nyitott űrlapon újra megjelenik
    a hibajegy szó vagy a "jegy"; ha a fejléc hivatkozása a hibajegyek útvonalára mutat; és ha a hibajegyből nyitott űrlap szavai megváltoznak.
  */
  it("a karbantartási lapról nyitott űrlap a karbantartás szavait és útvonalát használja", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockResolvedValue({
      id: "job-1",
      kind: "MAINTENANCE",
      jobNumber: "KT-2026-004",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
      departmentId: "department-1",
      departmentName: "Biotóp",
      assets: [],
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
      ],
    });
    render(<PilotWorksheetCreatePage />);

    const link = await screen.findByRole("link", { name: "KT-2026-004" });
    expect(link.getAttribute("href")).toBe("/szerviz/karbantartas/job-1");
    expect(screen.getByText(/Karbantartási lap:/)).toBeTruthy();
    await screen.findByText(/A karbantartási lapból nyitott munkalap/);
    const leftover = (document.body.textContent ?? "").match(
      /.{0,30}(hiba|(?<![a-zé])jegy).{0,30}/i,
    )?.[0];
    if (leftover) throw new Error(`LEFTOVER<<${leftover}>>`);
  });

  it("a hibajegyből nyitott űrlap a hibajegy szavait és útvonalát tartja", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockResolvedValue({
      id: "job-1",
      kind: "REPAIR",
      jobNumber: "HJ-2026-009",
      customerId: "customer-42",
      customerName: "Fankó Kft.",
      departmentId: "department-1",
      departmentName: "Biotóp",
      assets: [],
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
      ],
    });
    render(<PilotWorksheetCreatePage />);

    const link = await screen.findByRole("link", { name: "HJ-2026-009" });
    expect(link.getAttribute("href")).toBe("/szerviz/hibajegyek/job-1");
    expect(screen.getByText(/Hibajegy:/)).toBeTruthy();
    expect(screen.getByText(/A hibajegyből nyitott lap/)).toBeTruthy();
  });

  /*
    A MUNKALAP TÁRGYA A LAP CÍME (Luca, 2026-11-20). MI PIROSÍT: ha a hibajegyből vagy a karbantartási lapról nyitott űrlap Tárgya
    nem a lap címe; ha az előtöltés felülírja, amit a felvivő már beírt (a betöltés alatt is); ha a cím nem szerkeszthető, vagy
    a szerkesztett érték nem megy a mentésbe; ha jegy nélkül (nincs `?hibajegy`) bármi előtöltődik; ha cím nélküli lap szöveget
    ír a mezőbe ("undefined"); ha a szerver hossz-korlátját (500) meghaladó cím előtöltődik.
  */
  const cimesJegy = (over: Record<string, unknown> = {}) => ({
    id: "job-1",
    kind: "REPAIR",
    jobNumber: "HJ-2026-021",
    title: "Szivattyú zajos a kamrában",
    customerId: "customer-42",
    customerName: "Fankó Kft.",
    departmentId: "department-1",
    departmentName: "Biotóp",
    assets: [],
    ...over,
  });
  const cimPartnerek = () => {
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
  };

  it("a hibajegyből nyitott munkalap tárgya a jegy címe, szerkeszthetően, és a szerkesztett érték megy a mentésbe", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockResolvedValue(cimesJegy());
    cimPartnerek();
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

    const targy = await screen.findByLabelText("Tárgy");
    await waitFor(() =>
      expect((targy as HTMLInputElement).value).toBe(
        "Szivattyú zajos a kamrában",
      ),
    );
    await user.type(targy, " (csere)");
    await user.click(await screen.findByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(worksheets.create).toHaveBeenCalledTimes(1));
    expect(worksheets.create.mock.calls[0]?.[1]?.subject).toBe(
      "Szivattyú zajos a kamrában (csere)",
    );
  });

  it("a karbantartási lapról nyitott munkalap tárgya is a lap címe", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockResolvedValue(
      cimesJegy({
        kind: "MAINTENANCE",
        jobNumber: "KT-2026-004",
        title: "Havi szűrőcsere",
        assignees: [],
      }),
    );
    cimPartnerek();
    render(<PilotWorksheetCreatePage />);
    const targy = await screen.findByLabelText("Tárgy");
    await waitFor(() =>
      expect((targy as HTMLInputElement).value).toBe("Havi szűrőcsere"),
    );
  });

  it("amit a felvivő a betöltés közben már beírt, azt a cím nem írja felül", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    let resolve: (value: unknown) => void = () => undefined;
    jobs.detail.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    cimPartnerek();
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);
    const targy = (await screen.findByLabelText("Tárgy")) as HTMLInputElement;
    await user.type(targy, "Saját tárgy");
    resolve(cimesJegy());
    await screen.findByRole("link", { name: "HJ-2026-021" });
    expect(targy.value).toBe("Saját tárgy");
  });

  it("jegy nélkül nem töltődik elő semmi, és a cím nélküli lap nem ír szöveget a mezőbe", async () => {
    cimPartnerek();
    const { unmount } = render(<PilotWorksheetCreatePage />);
    expect(
      ((await screen.findByLabelText("Tárgy")) as HTMLInputElement).value,
    ).toBe("");
    unmount();
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockResolvedValue(cimesJegy({ title: undefined }));
    render(<PilotWorksheetCreatePage />);
    await screen.findByRole("link", { name: "HJ-2026-021" });
    expect((screen.getByLabelText("Tárgy") as HTMLInputElement).value).toBe("");
  });

  it("a szerver hossz-korlátját (500) meghaladó cím levágva töltődik elő", async () => {
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockResolvedValue(cimesJegy({ title: "x".repeat(600) }));
    cimPartnerek();
    render(<PilotWorksheetCreatePage />);
    const targy = (await screen.findByLabelText("Tárgy")) as HTMLInputElement;
    await waitFor(() => expect(targy.value.length).toBe(500));
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
      "Helyszín",
    )) as HTMLSelectElement;
    await waitFor(() => expect(alegyseg.value).toBe("department-1"));
  });

  it("helyszín nélküli jegynél a választó üres marad", async () => {
    jegyHelyszinnel(null, null);
    render(<PilotWorksheetCreatePage />);

    const alegyseg = (await screen.findByLabelText(
      "Helyszín",
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
      "Helyszín",
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
    await waitFor(() =>
      expect(mentes.getAttribute("aria-disabled")).toBe("true"),
    );
    expect(worksheets.create).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Helyszín"), "department-1");
    await waitFor(() =>
      expect(mentes.getAttribute("aria-disabled")).toBe("false"),
    );
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
      await screen.findByText(/Ehhez a partnerhez még nincs helyszín/),
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
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );

    expect(
      await screen.findByText("A munkalapszám első tagja is ebből lesz."),
    ).toBeTruthy();
    expect(screen.queryByText(/még nincs helyszín/)).toBeNull();
  });

  it("creates an unassigned sheet without complaining", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);

    await user.selectOptions(
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );
    await user.selectOptions(
      await listedSelect("Helyszín", "department-1"),
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
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );
    // the units come with the chosen partner's answer, after the field
    await answered(worksheets.departments);

    const picker = within(await screen.findByLabelText("Helyszín"));
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
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );
    await nyisdKiAzUjAlegysegett(user);
    await user.selectOptions(
      await listedSelect("Szülő helyszín", "bio-fank"),
      "bio-fank",
    );
    await user.type(screen.getByLabelText("Új helyszín kódja"), "fnm");
    await user.type(
      screen.getByLabelText("Új helyszín neve"),
      "Nagy főkamedence",
    );
    await user.click(
      screen.getByRole("button", { name: "Helyszín felvitele" }),
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
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );
    await answered(worksheets.departments);

    const offered = await optionsOf("Helyszín");
    expect(offered.some((text) => text.includes("Biodóm"))).toBe(true);
    expect(offered.some((text) => text.includes("Régi szárny"))).toBe(false);
  });

  it("keeps an archived unit out of the parent picker", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);
    await user.selectOptions(
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );
    await answered(worksheets.departments);
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

    // a gombsor Mégse-je gomb (a közös űrlap-váz), nem hivatkozás: a céllal a visszalépés (`useReturnTo`) szolgál
    fireEvent.click(await screen.findByRole("button", { name: "Mégse" }));
    expect(navigation.push).toHaveBeenCalledWith("/szerviz/munkalapok");
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

describe("PilotWorksheetCreatePage: a karbantartási lap felelősei (kártya d91005e9)", () => {
  /**
   * MI PIROSÍT: ha a karbantartási lap felelősei nincsenek előre kijelölve a munkalapon; ha hibajegyből nyitott lapon is
   * előre kijelölődnek (a hibajegy delegáltja nem feltétlenül végzi a munkalapot); ha egy kiosztható felelős nem jelölődik,
   * vagy egy nem kiosztható (a szerepköre nem engedi) igen, vagy a kimaradása néma; ha a felvivő kijelölése felülírható az
   * előtöltéssel (a lap betöltése a felvivő nyúlása után ér be); ha a felvivő nem tud levenni egy előre kijelölt felelőst;
   * ha az előtöltött lista nem megy el a mentéssel.
   */
  const kollegak = [
    { id: "anna", name: "Anna", role: "SERVICE" },
    { id: "bela", name: "Béla", role: "SERVICE" },
    { id: "cili", name: "Cili", role: "SERVICE" },
  ];
  const lap = (over: Record<string, unknown> = {}) => ({
    id: "job-1",
    kind: "MAINTENANCE",
    jobNumber: "KT-2026-007",
    customerId: "customer-42",
    customerName: "Fankó Kft.",
    departmentId: "department-1",
    departmentName: "Biotóp",
    assets: [],
    assignees: [
      { userId: "anna", name: "Anna", assignedAt: "2026-11-19T08:00:00.000Z" },
      { userId: "bela", name: "Béla", assignedAt: "2026-11-19T08:00:00.000Z" },
    ],
    ...over,
  });

  beforeEach(() => {
    auth.session = session;
    worksheets.departments.mockReset().mockResolvedValue({
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
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.assignableUsers
      .mockReset()
      .mockResolvedValue({ items: kollegak });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
    assets.list.mockReset().mockResolvedValue({ items: [], total: 0 });
    query.params = new URLSearchParams("hibajegy=job-1");
    jobs.detail.mockReset().mockResolvedValue(lap());
  });

  const checked = async (name: string) =>
    (await screen.findByRole("checkbox", {
      name: new RegExp(name),
    })) as HTMLInputElement;

  it("a karbantartási lap felelősei előre ki vannak jelölve, a többi kolléga nem", async () => {
    render(<PilotWorksheetCreatePage />);
    await waitFor(async () =>
      expect((await checked("Anna")).checked).toBe(true),
    );
    expect((await checked("Béla")).checked).toBe(true);
    expect((await checked("Cili")).checked).toBe(false);
    expect(screen.getByTestId("assignee-prefill-note").textContent).toMatch(
      /előre ki vannak jelölve/,
    );
    expect(screen.queryByTestId("assignee-prefill-dropped")).toBeNull();
  });

  it("hibajegyből nyitott lapon a delegáltak nem jelölődnek ki", async () => {
    jobs.detail.mockResolvedValue(lap({ kind: "REPAIR" }));
    render(<PilotWorksheetCreatePage />);
    await screen.findByRole("link", { name: "KT-2026-007" });
    expect((await checked("Anna")).checked).toBe(false);
    expect((await checked("Béla")).checked).toBe(false);
    expect(screen.queryByTestId("assignee-prefill-note")).toBeNull();
  });

  it("aki a munkalapra nem osztható ki, kimarad, és a felvivő látja, ki maradt ki", async () => {
    worksheets.assignableUsers.mockResolvedValue({
      items: kollegak.filter((k) => k.id !== "bela"),
    });
    render(<PilotWorksheetCreatePage />);
    await waitFor(async () =>
      expect((await checked("Anna")).checked).toBe(true),
    );
    expect(
      (await screen.findByTestId("assignee-prefill-dropped")).textContent,
    ).toMatch(/Béla/);
    expect(screen.queryByRole("checkbox", { name: /Béla/ })).toBeNull();
  });

  it("az előre kijelölt felelős levehető, és más hozzáadható", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);
    await waitFor(async () =>
      expect((await checked("Anna")).checked).toBe(true),
    );
    await user.click(await checked("Anna"));
    await user.click(await checked("Cili"));
    expect((await checked("Anna")).checked).toBe(false);
    expect((await checked("Cili")).checked).toBe(true);
    expect((await checked("Béla")).checked).toBe(true);
  });

  it("amit a felvivő már kijelölt, azt a később beérkező lap nem írja felül", async () => {
    let resolveLap: (value: unknown) => void = () => undefined;
    jobs.detail
      .mockReset()
      .mockReturnValue(new Promise((resolve) => (resolveLap = resolve)));
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);
    // a kollégák listája megvan, a lap még nem érkezett meg: a felvivő kijelöli Cilit
    await user.click(await checked("Cili"));
    resolveLap(lap());
    await screen.findByRole("link", { name: "KT-2026-007" });
    expect((await checked("Cili")).checked).toBe(true);
    expect((await checked("Anna")).checked).toBe(false);
    expect((await checked("Béla")).checked).toBe(false);
  });
});

/**
 * AZ ÚJ MUNKALAP ŰRLAP A KÖZÖS VÁZON (picasso leltár 3.7, acrobot 2026-11-25): ugyanazok a csoport-címek ugyanabban a sorrendben, mint az új hibajegyen,
 * egy kötelező-jelölés, a "Hiányzik: ..." összesítő a gombsorban, a "Helyszín" egy szó (acrobot: egy fogalom, egy szó). MI PIROSÍT: ha a csoportok
 * sorrendje vagy a címük eltér a hibajegy űrlapétól; ha a kötelező mező csillag nélkül, a nem kötelező "(nem kötelező)" nélkül marad; ha az összesítő más
 * alakú; ha a halvány mentésre kattintva nem a mező hibái jelennek meg (vagy mégis mentene); ha a Tételek külön kártyává válik a csoporton belül.
 * A kötelezőségi szabály és a mentés hívása ehhez nem változik (a fenti tesztek).
 */
describe("PilotWorksheetCreatePage: a közös űrlap-váz", () => {
  beforeEach(() => {
    auth.session = session;
    query.params = new URLSearchParams();
    worksheets.departments.mockReset().mockResolvedValue({ items: [] });
    worksheets.selectablePartners.mockReset().mockResolvedValue({ items: [] });
    worksheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
    assets.list.mockReset().mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
    });
  });

  it("a csoportok kérdés-című kártyák ugyanabban a sorrendben, mint az új hibajegyen (plusz a Mikor)", async () => {
    render(<PilotWorksheetCreatePage />);
    await screen.findByLabelText("Partner");
    const titles = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
      .filter((text) => text !== "Mi történik ezután");
    expect(titles).toEqual([
      "Kinek és hol?",
      "Mi a munka?",
      "Mikor?",
      "Ki felel érte?",
    ]);
  });

  it("a kötelező mezők csillagosak, a többi '(nem kötelező)'", async () => {
    render(<PilotWorksheetCreatePage />);
    await screen.findByLabelText("Partner");
    for (const name of ["Partner", "Helyszín", "Tárgy"]) {
      const label = screen.getByText(name, { selector: "label" });
      expect(label.textContent, name).toContain("*");
      expect(label.textContent, name).not.toContain("(nem kötelező)");
    }
    for (const name of [
      "Megjegyzés",
      "Érintett eszközök",
      "Keltezés",
      "Határidő",
      "Teljesítés",
      "Felelős",
    ]) {
      const label = screen.getByText(name, { selector: "label" });
      expect(label.textContent, name).toContain("(nem kötelező)");
      expect(label.textContent, name).not.toContain("*");
    }
  });

  it("az összesítő a gombsorban egy alakban, a mentés halvány; a halvány mentésre a hibák a mezőknél jelennek meg, és nem ment", async () => {
    render(<PilotWorksheetCreatePage />);
    await screen.findByLabelText("Partner");
    expect(screen.getByRole("status").textContent).toBe(
      "Hiányzik: Partner, Helyszín, Tárgy",
    );
    const save = screen.getByRole("button", { name: "Mentés" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(save);
    expect(
      screen.getAllByRole("alert").map((alert) => alert.textContent),
    ).toEqual([
      "Válassz partnert.",
      "Válassz helyszínt.",
      "Add meg a munkalap tárgyát.",
    ]);
    expect(worksheets.create).not.toHaveBeenCalled();
  });

  it("a Tételek a 'Mi a munka?' kártya része (al-cím, nem külön kártya), és az '+ Új tétel' a lista alatt áll", async () => {
    render(<PilotWorksheetCreatePage />);
    await screen.findByLabelText("Partner");
    const items = screen.getByRole("heading", { name: "Tételek" });
    expect(items.tagName).toBe("H3");
    const card = items.closest("section")!;
    expect(
      within(card).getByRole("heading", { level: 2, name: "Mi a munka?" }),
    ).toBeTruthy();
    const add = within(card).getByRole("button", { name: "+ Új tétel" });
    const firstLine = within(card).getByLabelText("1. tétel megnevezése");
    expect(
      firstLine.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("az új helyszín mini-űrlapja a kötelező jelölést viszi: a kód és a név csillagos, a szülő nem kötelező", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    const user = userEvent.setup();
    render(<PilotWorksheetCreatePage />);
    await user.selectOptions(
      await listedSelect("Partner", "customer-42"),
      "customer-42",
    );
    await user.click(
      await screen.findByRole("button", { name: "+ Új helyszín hozzáadása" }),
    );
    for (const name of ["Új helyszín kódja", "Új helyszín neve"])
      expect(
        screen.getByText(name, { selector: "label" }).textContent,
      ).toContain("*");
    expect(
      screen.getByText("Szülő helyszín", { selector: "label" }).textContent,
    ).toContain("(nem kötelező)");
  });
});
