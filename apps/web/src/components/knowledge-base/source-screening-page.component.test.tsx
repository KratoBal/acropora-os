import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeSourceRow } from "@/lib/api/knowledge-base";
import {
  SourceScreeningPage,
  bulkResultText,
  sourceMeta,
} from "./source-screening-page";

/**
 * A FORRÁSSZŰRÉS (Research & Knowledge Engine S4, Figma 3:68). A szerkesztő
 * befogad vagy okkal kizár; a gombok csak a knowledge.manage joggal látszanak;
 * a kizárás okot kér, az „egyéb” megjegyzést; billentyűvel is megy. Tömegesen
 * (Picasso 3.26-b): jelölés soronként, oldalanként vagy a szűrt lista minden
 * döntésre váró soráról, egy döntés megerősítés után; a soronkénti gombok maradnak.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tudasbazis/forrasok",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  sources: vi.fn(),
  screeningSummary: vi.fn(),
  screen: vi.fn(),
  uploadManualPdf: vi.fn(),
  classifySource: vi.fn(),
  pendingSourceIds: vi.fn(),
  screenMany: vi.fn(),
}));
vi.mock("@/lib/api/knowledge-base", () => ({ knowledgeBaseApi: api }));

const auth = vi.hoisted(() => ({ role: "OWNER" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "U",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const source = (
  id: string,
  over: Partial<KnowledgeSourceRow> = {},
): KnowledgeSourceRow => ({
  id,
  title: `Kitalált cikk ${id}`,
  authors: ["A", "B", "C"],
  authorCount: 5,
  year: 2022,
  venue: "Kitalált Folyóirat",
  kind: "PEER_REVIEWED",
  studyType: null,
  licence: "CC-BY",
  openAccess: true,
  doi: `10.5555/${id}`,
  url: `https://doi.org/10.5555/${id}`,
  retracted: false,
  corrected: false,
  retractionUnchecked: false,
  fullTextRead: false,
  screening: {
    status: "PENDING",
    reason: null,
    note: null,
    by: null,
    at: null,
  },
  ...over,
});

const SUMMARY = {
  identified: 82,
  unique: 75,
  notNew: 7,
  pending: 28,
  included: 24,
  excluded: 23,
  excludedByReason: {
    NOT_MARINE: 5,
    NOT_CORAL: 6,
    NOT_RELEVANT: 10,
    DUPLICATE: 2,
    OTHER: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "OWNER";
  api.sources.mockResolvedValue({
    items: [
      source("s1"),
      source("s2", { retracted: true, licence: "UNKNOWN" }),
    ],
    total: 2,
    page: 1,
    pageSize: 25,
  });
  api.screeningSummary.mockResolvedValue(SUMMARY);
  api.screen.mockResolvedValue(source("s1"));
  api.screenMany.mockResolvedValue({ decided: 2, notPending: 0, missing: 0 });
});

const rowOf = async (title: string) =>
  (await screen.findByText(title)).closest('[role="listitem"]') as HTMLElement;

describe("Tömeges döntés (Picasso 3.26-b)", () => {
  it("soronként jelöl, egy Befogad megerősítés után mindre megy; a soronkénti gombok maradnak", async () => {
    render(<SourceScreeningPage />);
    fireEvent.click(
      within(await rowOf("Kitalált cikk s1")).getByRole("checkbox"),
    );
    fireEvent.click(
      within(await rowOf("Kitalált cikk s2")).getByRole("checkbox"),
    );
    expect(screen.getByText("2 kijelölve")).toBeTruthy();
    // the row's own buttons are still there
    expect(
      within(await rowOf("Kitalált cikk s1")).getByRole("button", {
        name: "Befogad",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Befogad (2)" }));
    expect(api.screenMany).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "2 befogadása" }),
    );
    await waitFor(() =>
      expect(api.screenMany).toHaveBeenCalledWith("token-1", {
        decision: "INCLUDE",
        ids: ["s1", "s2"],
      }),
    );
    expect(await screen.findByText("2 forrás döntése mentve.")).toBeTruthy();
    await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("2 kijelölve")).toBeNull();
  });

  it("a szűrt lista minden döntésre váró sorát kijelöli, oldalszám nélkül; a Kizár okot kér", async () => {
    const ids = Array.from({ length: 510 }, (_, i) => `x${i}`);
    api.pendingSourceIds.mockResolvedValue({ ids, total: 510 });
    api.screenMany.mockResolvedValue({
      decided: 507,
      notPending: 3,
      missing: 0,
    });
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    fireEvent.click(
      screen.getByRole("button", { name: "Mind kijelölése a szűrt listán" }),
    );
    expect(await screen.findByText("510 kijelölve")).toBeTruthy();
    const params = api.pendingSourceIds.mock.calls[0]![1] as URLSearchParams;
    expect([params.get("status"), params.has("page")]).toEqual([
      "PENDING",
      false,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Kizár (510)" }));
    const bar = screen.getByLabelText("Tömeges döntés");
    fireEvent.change(within(bar).getByLabelText("Kizárás oka"), {
      target: { value: "OTHER" },
    });
    const save = within(bar).getByRole("button", {
      name: "Kizárás mentése (510)",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(bar).getByLabelText("Megjegyzés"), {
      target: { value: "nem korall" },
    });
    fireEvent.click(save);
    fireEvent.click(
      await screen.findByRole("button", { name: "510 kizárása" }),
    );
    await waitFor(() =>
      expect(api.screenMany).toHaveBeenCalledWith("token-1", {
        decision: "EXCLUDE",
        reason: "OTHER",
        note: "nem korall",
        ids,
      }),
    );
    expect(
      await screen.findByText(
        "507 forrás döntése mentve. 3 közben már döntést kapott, az változatlan maradt.",
      ),
    ).toBeTruthy();
  });

  it("ha a lista hosszabb, mint amennyi egyszerre kijelölhető, kimondja; szűrő-váltáskor a kijelölés elmúlik", async () => {
    api.pendingSourceIds.mockResolvedValue({ ids: ["a", "b"], total: 1200 });
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    fireEvent.click(
      screen.getByRole("button", { name: "Mind kijelölése a szűrt listán" }),
    );
    expect(
      await screen.findByText(
        "A szűrt listán 1200 döntésre váró forrás van; egyszerre 2 jelölhető ki.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("2 kijelölve")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Szűrők" }));
    fireEvent.change(screen.getByLabelText("Típus"), {
      target: { value: "REVIEW" },
    });
    await waitFor(() => expect(screen.queryByText("2 kijelölve")).toBeNull());
  });

  it("az oldal jelölője az oldal döntésre váró sorait jelöli; szóköz a kiválasztott sort", async () => {
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    fireEvent.click(
      screen.getByLabelText("Az oldal döntésre váró sorainak kijelölése"),
    );
    expect(screen.getByText("2 kijelölve")).toBeTruthy();
    const list = screen.getByRole("list", {
      name: "Döntésre váró publikációk",
    });
    fireEvent.keyDown(list, { key: " " });
    expect(screen.getByText("1 kijelölve")).toBeTruthy();
  });

  it("a MANAGER nem jelöl és tömegesen sem dönt", async () => {
    auth.role = "MANAGER";
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("Tömeges döntés")).toBeNull();
  });

  it("a döntött sornak nincs jelölője", async () => {
    api.sources.mockResolvedValue({
      items: [
        source("s1"),
        source("s3", {
          screening: {
            status: "INCLUDED",
            reason: null,
            note: null,
            by: null,
            at: null,
          },
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s3");
    // by name: the included row has the study type's "control group" box, which is no selection
    expect(
      screen.queryByRole("checkbox", { name: "Kitalált cikk s3 kijelölése" }),
    ).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Kitalált cikk s1 kijelölése" }),
    ).toBeTruthy();
  });

  it("az eredmény-mondat csak azt mondja, ami történt", () => {
    expect(bulkResultText({ decided: 4, notPending: 0, missing: 0 })).toBe(
      "4 forrás döntése mentve.",
    );
    expect(bulkResultText({ decided: 0, notPending: 2, missing: 1 })).toBe(
      "0 forrás döntése mentve. 2 közben már döntést kapott, az változatlan maradt. 1 forrás már nem létezik.",
    );
  });
});

describe("Forrásszűrés", () => {
  it("a fejléc, a PRISMA-számláló és a döntésre váró lista; a visszavont piros jelet kap", async () => {
    render(<SourceScreeningPage />);
    expect(await screen.findByText("Kitalált cikk s1")).toBeTruthy();
    expect(screen.getByText("Szakirodalmi források")).toBeTruthy();
    expect(screen.getByText("Döntésre váró publikációk")).toBeTruthy();
    const counts = screen.getByLabelText("Szűrési napló");
    expect(within(counts).getByText("82")).toBeTruthy();
    // not called a duplicate count: it holds more than duplicates (#1841)
    const notNew = within(counts).getByText("Nem lett új forrás:");
    expect(notNew.parentElement?.textContent).toBe("Nem lett új forrás:7");
    expect(notNew.parentElement?.getAttribute("title")).toMatch(
      /Nem csak duplikátum/,
    );
    expect(within(counts).queryByText(/Duplikátum/)).toBeNull();
    expect(screen.getByText("Visszavont")).toBeTruthy();
    // alapból a döntésre várókat kéri
    expect(api.sources.mock.calls[0]?.[1].get("status")).toBe("PENDING");
  });

  /*
    A CÍM NEM TÖRHET SZAVANKÉNT 390 PX-EN (UI-áttekintés, Single-page P1, 2026-11-03). A sor szövegblokkja
    `flex-1` volt (0 alapméret), a döntés-gombok mellette osztoztak a 358 px-en, és a cím ~150 px-re szorult:
    szavanként tört, az oldal ~11 000 px magas lett. A szövegblokk most 18 rem alapméretű (`flex-[1_1_18rem]`), a
    gombok alatta sorba törnek, ha nem férnek mellé. A happy-dom nem számol elrendezést: az állítás az osztályra szól.
    MI PIROSÍT: ha a szövegblokk újra 0 alapméretű (`flex-1`), vagy a sor elveszti a `flex-wrap`-ot.
  */
  it("a forrás szövegblokkja saját alapmérettel áll, a gombok mellőle sorba törnek", async () => {
    render(<SourceScreeningPage />);
    const title = await screen.findByText("Kitalált cikk s1");
    const textBlock = title.closest("div.min-w-0")!;
    expect(textBlock.className).toContain("flex-[1_1_18rem]");
    expect(textBlock.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
    expect(textBlock.parentElement!.classList.contains("flex-wrap")).toBe(true);
  });

  it("Befogad: a döntés elmegy, a lista újratölt", async () => {
    render(<SourceScreeningPage />);
    const row = (await screen.findByText("Kitalált cikk s1")).closest(
      '[role="listitem"]',
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Befogad" }));
    await waitFor(() =>
      expect(api.screen).toHaveBeenCalledWith("token-1", "s1", {
        decision: "INCLUDE",
      }),
    );
    await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2));
  });

  it("Kizár: okot kér; az „egyéb” megjegyzés nélkül nem menthető", async () => {
    render(<SourceScreeningPage />);
    const row = (await screen.findByText("Kitalált cikk s1")).closest(
      '[role="listitem"]',
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Kizár" }));
    fireEvent.change(within(row).getByLabelText("Kizárás oka"), {
      target: { value: "OTHER" },
    });
    const save = within(row).getByRole("button", {
      name: "Kizárás mentése",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(row).getByLabelText("Megjegyzés"), {
      target: { value: "édesvízi" },
    });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.screen).toHaveBeenCalledWith("token-1", "s1", {
        decision: "EXCLUDE",
        reason: "OTHER",
        note: "édesvízi",
      }),
    );
  });

  it("billentyűvel: J a következőre lép, B befogadja", async () => {
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    const list = screen.getByRole("list", {
      name: "Döntésre váró publikációk",
    });
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "b" });
    await waitFor(() =>
      expect(api.screen).toHaveBeenCalledWith("token-1", "s2", {
        decision: "INCLUDE",
      }),
    );
  });

  it("a MANAGER olvas, de döntés-gombot nem lát", async () => {
    auth.role = "MANAGER";
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    expect(screen.queryByRole("button", { name: "Befogad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kizár" })).toBeNull();
    expect(screen.queryByText(/Billentyűvel/)).toBeNull();
  });

  it("jog nélkül nem kér semmit, és megmondja, mi hiányzik", async () => {
    auth.role = "SALES";
    render(<SourceScreeningPage />);
    expect(await screen.findByText("Nincs jogosultság")).toBeTruthy();
    expect(api.sources).not.toHaveBeenCalled();
  });

  it("hiba: kimondja, és újrapróbálható", async () => {
    api.sources.mockRejectedValueOnce(new Error("HTTP 500"));
    render(<SourceScreeningPage />);
    expect(await screen.findByText("A források nem tölthetők be")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Újra" }));
    expect(await screen.findByText("Kitalált cikk s1")).toBeTruthy();
  });

  it("üres: forrás nélkül a felderítést ajánlja", async () => {
    api.sources.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    api.screeningSummary.mockResolvedValue({ ...SUMMARY, unique: 0 });
    render(<SourceScreeningPage />);
    expect(await screen.findByText(/Még nincs forrás/)).toBeTruthy();
  });

  it("a sor alcíme: év · típus · hozzáférés, ismeretlen licencnél ellenőrzendő", () => {
    expect(sourceMeta(source("x"))).toBe(
      "2022 · Szakcikk · Nyílt hozzáférés · CC-BY",
    );
    expect(sourceMeta(source("x", { licence: "UNKNOWN" }))).toBe(
      "2022 · Szakcikk · Nyílt hozzáférés · Licenc ellenőrzendő",
    );
    expect(
      sourceMeta(
        source("x", {
          openAccess: false,
          studyType: "CONTROLLED_LAB",
          year: null,
        }),
      ),
    ).toBe("év nélkül · Kísérlet · Teljes szöveg nélkül");
  });
});

// research-kezi-pdf: an included source whose text was never read takes the editor's PDF
describe("Kézi PDF", () => {
  const included = (id: string, over: Partial<KnowledgeSourceRow> = {}) =>
    source(id, {
      screening: {
        status: "INCLUDED",
        reason: null,
        note: null,
        by: null,
        at: null,
      },
      ...over,
    });
  const list = (items: KnowledgeSourceRow[]) =>
    api.sources.mockResolvedValue({
      items,
      total: items.length,
      page: 1,
      pageSize: 25,
    });

  it("an included, unread source: the PDF goes up, and the screen says the reading started", async () => {
    list([included("s1")]);
    api.uploadManualPdf.mockResolvedValue({ id: "run1", status: "RUNNING" });
    render(<SourceScreeningPage />);
    const input = (await screen.findByTestId(
      "manual-pdf-s1",
    )) as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "cikk.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(api.uploadManualPdf).toHaveBeenCalledWith("token-1", "s1", file),
    );
    expect(await screen.findByText(/A kiolvasás elindult/)).toBeTruthy();
  });

  it("not offered for a read, a retracted or a pending source", async () => {
    list([
      included("s1", { fullTextRead: true }),
      included("s2", { retracted: true }),
      source("s3"),
    ]);
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    expect(screen.queryByTestId(/^manual-pdf-/)).toBeNull();
  });

  it("not offered without the extraction run's permission", async () => {
    auth.role = "MANAGER";
    list([included("s1")]);
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    expect(screen.queryByTestId("manual-pdf-s1")).toBeNull();
  });

  it("a refused upload is said, in the API's words", async () => {
    list([included("s1")]);
    api.uploadManualPdf.mockRejectedValue(
      new Error("A feltöltött fájl nem PDF."),
    );
    render(<SourceScreeningPage />);
    const input = (await screen.findByTestId(
      "manual-pdf-s1",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "x.pdf")] } });
    expect(await screen.findByText("A feltöltött fájl nem PDF.")).toBeTruthy();
  });
});

// research-diagram-irany: an included source no anchor classifies gets its study type from the editor
describe("Vizsgálati típus", () => {
  const included = (id: string, over: Partial<KnowledgeSourceRow> = {}) =>
    source(id, {
      screening: {
        status: "INCLUDED",
        reason: null,
        note: null,
        by: null,
        at: null,
      },
      ...over,
    });
  const list = (items: KnowledgeSourceRow[]) =>
    api.sources.mockResolvedValue({
      items,
      total: items.length,
      page: 1,
      pageSize: 25,
    });

  it("an included source without a type: the type and the note are required, they go with the control group, then the list reloads", async () => {
    list([included("s1")]);
    api.classifySource.mockResolvedValue(
      included("s1", { studyType: "CONTROLLED_LAB" }),
    );
    render(<SourceScreeningPage />);
    const box = await screen.findByLabelText("Vizsgálati típus");
    const save = within(box).getByRole("button", {
      name: "Típus mentése",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(box).getByLabelText("Vizsgálati típus megadása"), {
      target: { value: "CONTROLLED_LAB" },
    });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(box).getByLabelText("Honnan derül ki"), {
      target: { value: "Methods: tank experiment" },
    });
    fireEvent.click(within(box).getByRole("checkbox"));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.classifySource).toHaveBeenCalledWith("token-1", "s1", {
        studyType: "CONTROLLED_LAB",
        controlled: true,
        note: "Methods: tank experiment",
      }),
    );
    await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2));
  });

  it("no form for a typed, a pending or a retracted source, nor for a reader without knowledge.manage", async () => {
    list([
      included("s1", { studyType: "REVIEW" }),
      source("s2"),
      included("s3", { retracted: true }),
    ]);
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s1");
    expect(screen.queryByLabelText("Vizsgálati típus")).toBeNull();
    cleanup();
    auth.role = "MANAGER";
    list([included("s4")]);
    render(<SourceScreeningPage />);
    await screen.findByText("Kitalált cikk s4");
    expect(screen.queryByLabelText("Vizsgálati típus")).toBeNull();
  });
});
