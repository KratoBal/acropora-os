import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Session,
  WorksheetListItem,
  WorksheetListResponse,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PilotWorksheetListPage,
  WORKSHEET_COLUMNS,
  WORKSHEET_TABLE_MIN_WIDTH,
  worksheetHoursCell,
} from "./pilot-worksheet-list-page";

/**
 * THE WORKSHEET LIST OF THE SERVICE REDESIGN (Figma 423:448, Balázs,
 * 2026-10-04). The Pilot list had no render test; this one measures the
 * columns the redesign adds or keeps: Felelős, Munkaóra and Hibajegy (API
 * E4), the tiles as filters, and the "mine" and hidden controls.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  usePathname: () => "/szerviz/munkalapok",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  selectablePartners: vi.fn(),
  bulkSheets: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "teszt@example.invalid",
      displayName: "Teszt Kolléga",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

function row(overrides: Partial<WorksheetListItem> = {}): WorksheetListItem {
  return {
    id: "ws-1",
    number: "ML-2026-00814",
    label: "ML-2026-00814/1",
    customerName: "Kitalált Partner Kft.",
    departmentCode: "KIT",
    departmentPath: ["Gépház", "Fő keringetés"],
    subject: "Tömítéscsere és ellenőrzés",
    status: "DRAFT",
    lineCount: 3,
    version: 1,
    versionCount: 1,
    grossAmount: "0",
    assigneeNames: ["Ádám", "Péter"],
    laborHours: "2.5",
    serviceJob: { id: "job-1", jobNumber: "HJ-2026-0142" },
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-04T08:00:00.000Z",
    hidden: false,
    ...overrides,
  };
}

function response(items: WorksheetListItem[]): WorksheetListResponse {
  return {
    items,
    pagination: { page: 1, pageSize: 25, totalItems: 9, totalPages: 1 },
    counts: { DRAFT: 7, AWAITING_SIGNATURE: 2, SIGNED: 31, REJECTED: 1 },
  };
}

beforeEach(() => {
  auth.session = sessionAs("ADMIN");
  navigation.search = "";
  navigation.replace.mockReset();
  navigation.push.mockReset();
  api.list.mockReset();
  api.selectablePartners.mockReset().mockResolvedValue({ items: [] });
  api.bulkSheets.mockReset();
  api.copy.mockReset();
});

describe("worksheetHoursCell", () => {
  it("writes the hours in Hungarian form, and a dash without lines", () => {
    expect(worksheetHoursCell({ lineCount: 3, laborHours: "2.5" })).toBe(
      "2,5 óra",
    );
    expect(worksheetHoursCell({ lineCount: 0, laborHours: "0" })).toBe("—");
  });
});

describe("PilotWorksheetListPage -- redesign", () => {
  it("shows the assignees by name, or says nobody is assigned", async () => {
    api.list.mockResolvedValue(
      response([row(), row({ id: "ws-2", assigneeNames: [] })]),
    );
    render(<PilotWorksheetListPage />);
    expect(await screen.findByText("Ádám, Péter")).toBeTruthy();
    expect(screen.getByText("Nincs kiosztva")).toBeTruthy();
  });

  // The list is the shared table: on the phone every row is a card, each cell labelled with its
  // column, and the service job link still does not open the row.
  it("labels every cell with its column for the phone card view", async () => {
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findAllByTestId("worksheet-row");
    const tableRow = screen.getAllByTestId("worksheet-row")[0]!;
    const labels = [...tableRow.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labels).toEqual([
      // the selection checkbox column (card a785e580): no text header, hidden on the phone card
      null,
      "Munkalap",
      "Partner / helyszín",
      "Felelős",
      "Állapot",
      "Megnyitva",
      "Munkaóra",
      // a oszlopban hibajegy (HJ-) és karbantartási lap (KT-) száma is áll, ezért a fejléc semleges (hibajegy-maradek lista, 2026-11-18)
      "Jegy / lap",
      null,
    ]);
  });

  it("shows the hours and links the service job without opening the row", async () => {
    api.list.mockResolvedValue(
      response([
        row(),
        row({
          id: "ws-2",
          number: null,
          lineCount: 0,
          laborHours: "0",
          serviceJob: null,
        }),
      ]),
    );
    render(<PilotWorksheetListPage />);
    expect(await screen.findByText("2,5 óra")).toBeTruthy();
    expect(screen.getByText("Még nincs száma")).toBeTruthy();
    const link = screen.getByRole("link", { name: "HJ-2026-0142" });
    expect(link.getAttribute("href")).toBe("/szerviz/hibajegyek/job-1");
    fireEvent.click(link);
    expect(navigation.push).not.toHaveBeenCalledWith(
      "/szerviz/munkalapok/ws-1",
    );
  });

  // KEYBOARD: Enter on the service job link must not open the worksheet (the shared table's row
  // handler used to swallow it), Enter on the focused row itself opens it.
  it("Enter on the service job link does not open the worksheet, Enter on the row does", async () => {
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    const link = await screen.findByRole("link", { name: "HJ-2026-0142" });
    const notPrevented = fireEvent.keyDown(link, { key: "Enter" });
    expect(notPrevented).toBe(true);
    expect(navigation.push).not.toHaveBeenCalledWith(
      "/szerviz/munkalapok/ws-1",
    );
    fireEvent.keyDown(screen.getAllByTestId("worksheet-row")[0]!, {
      key: "Enter",
    });
    expect(navigation.push).toHaveBeenCalledWith("/szerviz/munkalapok/ws-1");
  });

  it("the fixed column widths fit the table minimum", () => {
    const sum = WORKSHEET_COLUMNS.reduce(
      (acc, c) => acc + Number(/^(\d+)px$/.exec(c.width ?? "")?.[1]),
      0,
    );
    expect(sum).toBeLessThanOrEqual(WORKSHEET_TABLE_MIN_WIDTH);
  });

  /*
    THE SUBJECT IS THE MAIN LINE, THE NUMBER UNDER IT (Balázs, 2026-10-26 12:48
    UTC, msg 1564259312728150148). What turns this red: the two swapped back.
  */
  it("shows the subject first and the number (or Még nincs száma) under it", async () => {
    api.list.mockResolvedValue(
      response([
        row(),
        row({ id: "ws-2", number: null, subject: "Szűrőcsere" }),
      ]),
    );
    render(<PilotWorksheetListPage />);
    const subject = await screen.findByText("Tömítéscsere és ellenőrzés");
    const cell = subject.closest("td") as HTMLElement;
    const lines = Array.from(cell.querySelectorAll("p")).map(
      (p) => p.textContent,
    );
    expect(lines[0]).toBe("Tömítéscsere és ellenőrzés");
    expect(lines[1]).toContain("ML-2026-00814");
    const draft = (await screen.findByText("Szűrőcsere")).closest(
      "td",
    ) as HTMLElement;
    expect(
      Array.from(draft.querySelectorAll("p")).map((p) => p.textContent)[1],
    ).toContain("Még nincs száma");
  });

  // AN EMPTY SUBJECT (barracuda, #1891 review): the number takes the main
  // line, and it does not stand a second time under it.
  it("puts the number first for an empty subject, once", async () => {
    api.list.mockResolvedValue(response([row({ subject: "  " })]));
    render(<PilotWorksheetListPage />);
    const number = await screen.findByText("ML-2026-00814");
    const cell = number.closest("td") as HTMLElement;
    expect(
      Array.from(cell.querySelectorAll("p")).map((p) => p.textContent),
    ).toEqual(["ML-2026-00814"]);
  });

  it("filters by a tile's status", async () => {
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    const tiles = await screen.findByLabelText("Munkalapok állapot szerint");
    await waitFor(() => expect(tiles.textContent).toContain("31"));
    fireEvent.click(screen.getByRole("button", { name: /Elkészült/ }));
    expect(navigation.replace).toHaveBeenCalledWith(
      expect.stringContaining("status=AWAITING_SIGNATURE"),
    );
  });

  it("keeps the 'only mine' filter on the assignee", async () => {
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Csak amit rám osztottak" }),
    );
    expect(navigation.replace).toHaveBeenCalledWith(
      expect.stringContaining("assigneeId=user-1"),
    );
  });

  it("offers the hidden rows only with the hide permission", async () => {
    api.list.mockResolvedValue(response([row()]));
    const { unmount } = render(<PilotWorksheetListPage />);
    expect(
      await screen.findByRole("button", { name: "Rejtettek is" }),
    ).toBeTruthy();
    unmount();
    auth.session = sessionAs("SERVICE");
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    expect(screen.queryByRole("button", { name: "Rejtettek is" })).toBeNull();
  });

  it("shows a long partner in full, not cut off", async () => {
    const longName =
      "Kitalált Állatkert Nonprofit Zártkörűen Működő Részvénytársaság";
    api.list.mockResolvedValue(response([row({ customerName: longName })]));
    render(<PilotWorksheetListPage />);
    const name = await screen.findByText(longName);
    expect(name.className).not.toContain("truncate");
  });
});

/*
  A LISTA SZŰRŐJE A KAPCSOLT MUNKA FAJTÁJA SZERINT (kártya 8219e7d6; Balázs 2026-11-18 19:18 UTC): Mind / Hibajegyes / Karbantartási. A szűrést a SZERVER végzi (a lista lapozott): a kapcsoló a `jobKind` kérés-paramétert állítja, és az
  oldalszámot az elsőre teszi. MI PIROSÍT: ha a három gomb valamelyike hiányzik; ha az aktuális állás nem látszik (`aria-pressed`); ha a gomb nem a `jobKind` paramétert állítja, vagy nem lapoz vissza az elsőre; ha a Mind nem törli a paramétert;
  ha az URL-ben álló érték nem megy át a szerverhez; ha a "Szűrők törlése" a fajtát nem törli (és a partner-szűrőt sem, EGY lépésben).
*/
describe("PilotWorksheetListPage -- a kapcsolt munka fajtája", () => {
  const gomb = (nev: string) => screen.getByRole("button", { name: nev });

  it("három gombot ad, és az alapállás a Mind", async () => {
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    expect(gomb("Mind").getAttribute("aria-pressed")).toBe("true");
    expect(gomb("Hibajegyes").getAttribute("aria-pressed")).toBe("false");
    expect(gomb("Karbantartási").getAttribute("aria-pressed")).toBe("false");
  });

  it("a Karbantartási a jobKind paramétert állítja, az első oldalra lapozva", async () => {
    navigation.search = "page=3";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    fireEvent.click(gomb("Karbantartási"));
    const url = new URL(
      navigation.replace.mock.calls.at(-1)![0] as string,
      "http://x",
    );
    expect(url.searchParams.get("jobKind")).toBe("MAINTENANCE");
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("a Mind törli a paramétert", async () => {
    navigation.search = "jobKind=REPAIR";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    fireEvent.click(gomb("Mind"));
    const url = new URL(
      navigation.replace.mock.calls.at(-1)![0] as string,
      "http://x",
    );
    expect(url.searchParams.has("jobKind")).toBe(false);
  });

  it("az URL-ben álló fajta átmegy a szerverhez, és a gomb jelzi", async () => {
    navigation.search = "jobKind=REPAIR";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    const query = api.list.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.get("jobKind")).toBe("REPAIR");
    expect(gomb("Hibajegyes").getAttribute("aria-pressed")).toBe("true");
    expect(gomb("Mind").getAttribute("aria-pressed")).toBe("false");
  });

  it("a Szűrők törlése a fajtát és a partnert is törli, EGY lépésben", async () => {
    navigation.search = "jobKind=MAINTENANCE&customerId=c1";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    navigation.replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Szűrők törlése" }));
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    const url = new URL(
      navigation.replace.mock.calls[0]![0] as string,
      "http://x",
    );
    expect(url.searchParams.has("jobKind")).toBe(false);
    expect(url.searchParams.has("customerId")).toBe(false);
  });
});

describe("PilotWorksheetListPage -- a Megnyitva oszlop és a tól-ig szűrő (kártya a785e580)", () => {
  /**
   * MI PIROSÍT: ha a Megnyitva oszlop az UTC szerinti napot írja (a budapesti 00:30-kor megnyitott lap előző napra
   * esne, a szűrővel ellentétben); ha a tól-ig mező nem a createdFrom/createdTo paramétert állítja, vagy az első oldalra
   * lapozás elmarad; ha az URL-ben álló dátum nem megy át a szerverhez, vagy nem látszik a mezőben; ha a Szűrők törlése
   * nem törli a dátumot (egy lépésben a többivel); ha a fordított tartomány nem mondja ki, mi a baj.
   */
  const urlOfLast = () =>
    new URL(navigation.replace.mock.calls.at(-1)![0] as string, "http://x");

  it("a Megnyitva a budapesti naptári napot írja: az UTC szerint előző napon, budapesti 00:30-kor megnyitott lap a jó napra esik", async () => {
    navigation.search = "";
    api.list.mockResolvedValue(
      response([row({ createdAt: "2026-11-18T23:30:00.000Z" })]),
    );
    render(<PilotWorksheetListPage />);
    const cella = (
      await screen.findAllByTestId("worksheet-row")
    )[0]!.querySelector('td[data-label="Megnyitva"]')!;
    expect(cella.textContent).toMatch(/2026\.\s*11\.\s*19\./);
  });

  it("a tól-ig mezők a createdFrom és a createdTo paramétert állítják, az első oldalra lapozva", async () => {
    navigation.search = "page=3";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    fireEvent.change(screen.getByLabelText("Megnyitva ettől a naptól"), {
      target: { value: "2026-11-18" },
    });
    expect(urlOfLast().searchParams.get("createdFrom")).toBe("2026-11-18");
    expect(urlOfLast().searchParams.get("page")).toBe("1");
    fireEvent.change(screen.getByLabelText("Megnyitva eddig a napig"), {
      target: { value: "2026-11-19" },
    });
    expect(urlOfLast().searchParams.get("createdTo")).toBe("2026-11-19");
  });

  it("a félig beírt nap nem szűrőváltozás: nem megy kérés, amíg a nap nincs készen", async () => {
    navigation.search = "";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    navigation.replace.mockClear();
    fireEvent.change(screen.getByLabelText("Megnyitva ettől a naptól"), {
      target: { value: "20261" },
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("egy mező kiürítése törli a paramétert (nem üres szöveget küld)", async () => {
    navigation.search = "createdFrom=2026-11-18";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    fireEvent.change(screen.getByLabelText("Megnyitva ettől a naptól"), {
      target: { value: "" },
    });
    expect(urlOfLast().searchParams.has("createdFrom")).toBe(false);
  });

  it("az URL-ben álló dátum átmegy a szerverhez, és látszik a mezőben", async () => {
    navigation.search = "createdFrom=2026-11-18&createdTo=2026-11-19";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    const query = api.list.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.get("createdFrom")).toBe("2026-11-18");
    expect(query.get("createdTo")).toBe("2026-11-19");
    // a mező magyarul mutatja a napot (a közös PilotDateField), nem a böngésző nyelvén
    expect(
      (screen.getByLabelText("Megnyitva ettől a naptól") as HTMLInputElement)
        .value,
    ).toBe("2026. 11. 18.");
    expect(
      (screen.getByLabelText("Megnyitva eddig a napig") as HTMLInputElement)
        .value,
    ).toBe("2026. 11. 19.");
  });

  it("a Szűrők törlése a dátumot is törli, egy lépésben", async () => {
    navigation.search =
      "createdFrom=2026-11-18&createdTo=2026-11-19&jobKind=MAINTENANCE";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    navigation.replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Szűrők törlése" }));
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    const url = urlOfLast();
    for (const kulcs of ["createdFrom", "createdTo", "jobKind"])
      expect(url.searchParams.has(kulcs)).toBe(false);
  });

  it("a fordított tartomány kimondja, mi a baj", async () => {
    navigation.search = "createdFrom=2026-11-20&createdTo=2026-11-19";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /kezdő dátum a záró dátum után/,
    );
  });

  it("rendes tartománynál nincs figyelmeztetés", async () => {
    navigation.search = "createdFrom=2026-11-19&createdTo=2026-11-19";
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/*
  A KIJELÖLT MUNKALAPOK EGYBEN (kártya a785e580, 2. szelet; Luca 2026-11-19 10:22 UTC). MI PIROSÍT: a pipa a sort is
  megnyitja; a sáv nem a kijelöltek számát mondja; a fejléc-pipa nem az oldal lapjait jelöli; a letöltés nem zipet kér,
  vagy nem a szerver fájlnevén ment; a nyomtatás nem a kattintás pillanatában nyit lapot (a böngésző a késői megnyitást
  tiltja), vagy nem összefűzött PDF-et kér; letiltott új lapnál nem töltődik le, és nem mondja ki; hibánál nyitva marad
  az üres lap, vagy a hiba nem látszik; a kimaradt lapok nincsenek kimondva.
*/
describe("PilotWorksheetListPage -- selection and bulk sheets", () => {
  const twoRows = () =>
    response([
      row(),
      row({ id: "ws-2", number: "ML-2026-00815", subject: "Szűrőcsere" }),
    ]);
  const result = (over: Record<string, unknown> = {}) => ({
    blob: new Blob(["%PDF"], { type: "application/pdf" }),
    fileName: "munkalapok-2026-11-19.zip",
    included: 2,
    skipped: 0,
    skippedNumbers: [],
    ...over,
  });

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:munkalapok");
    URL.revokeObjectURL = vi.fn();
  });

  const select = async () => {
    api.list.mockResolvedValue(twoRows());
    render(<PilotWorksheetListPage />);
    await screen.findAllByTestId("worksheet-row");
    fireEvent.click(
      screen.getByLabelText("Kijelölés: Tömítéscsere és ellenőrzés"),
    );
    fireEvent.click(screen.getByLabelText("Kijelölés: Szűrőcsere"));
  };

  it("the checkboxes select without opening the row, and the bar counts them", async () => {
    await select();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Kijelölt munkalapok" }).textContent,
    ).toContain("2 munkalap kijelölve");
    fireEvent.click(screen.getByLabelText("Kijelölés: Szűrőcsere"));
    expect(
      screen.getByRole("region", { name: "Kijelölt munkalapok" }).textContent,
    ).toContain("1 munkalap kijelölve");
    fireEvent.click(screen.getByRole("button", { name: "Kijelölés törlése" }));
    expect(
      screen.queryByRole("region", { name: "Kijelölt munkalapok" }),
    ).toBeNull();
    // the header box takes the whole page, and a second press clears it
    fireEvent.click(
      screen.getByLabelText("Az oldal összes munkalapjának kijelölése"),
    );
    expect(
      screen.getByRole("region", { name: "Kijelölt munkalapok" }).textContent,
    ).toContain("2 munkalap kijelölve");
    fireEvent.click(
      screen.getByLabelText("Az oldal összes munkalapjának kijelölése"),
    );
    expect(
      screen.queryByRole("region", { name: "Kijelölt munkalapok" }),
    ).toBeNull();
  });

  it("download asks for one zip of the selected sheets and saves it under the server's name", async () => {
    api.bulkSheets.mockResolvedValue(
      result({ skipped: 1, skippedNumbers: ["ML-2026-00800"], included: 1 }),
    );
    const clicked: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(`${this.download}|${this.href}`);
      });
    await select();
    fireEvent.click(screen.getByRole("button", { name: "Letöltés (zip)" }));
    await waitFor(() =>
      expect(clicked).toEqual(["munkalapok-2026-11-19.zip|blob:munkalapok"]),
    );
    expect(api.bulkSheets).toHaveBeenCalledWith(
      "token-1",
      ["ws-1", "ws-2"],
      "zip",
    );
    const note = (await screen.findByRole("status")).textContent ?? "";
    expect(note).toContain("A zip 1 munkalap PDF-jét tartalmazza.");
    expect(note).toContain("ML-2026-00800");
    click.mockRestore();
  });

  it("print opens the new tab at the click, then shows the merged PDF in it", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);
    let openedBeforeRequest = false;
    api.bulkSheets.mockImplementation(async () => {
      openedBeforeRequest = open.mock.calls.length === 1;
      return result({ fileName: "munkalapok.pdf" });
    });
    await select();
    fireEvent.click(screen.getByRole("button", { name: "Nyomtatás" }));
    await waitFor(() => expect(tab.location.href).toBe("blob:munkalapok"));
    expect(openedBeforeRequest).toBe(true);
    expect(api.bulkSheets).toHaveBeenCalledWith(
      "token-1",
      ["ws-1", "ws-2"],
      "merged",
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      "A nyomtatható PDF 2 munkalapot tartalmaz.",
    );
    open.mockRestore();
  });

  it("a blocked tab downloads the PDF instead and says so", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const clicked: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
    api.bulkSheets.mockResolvedValue(result({ fileName: "munkalapok.pdf" }));
    await select();
    fireEvent.click(screen.getByRole("button", { name: "Nyomtatás" }));
    await waitFor(() => expect(clicked).toEqual(["munkalapok.pdf"]));
    expect((await screen.findByRole("status")).textContent).toContain(
      "a böngésző letiltotta",
    );
    open.mockRestore();
    click.mockRestore();
  });

  it("an error closes the empty tab and shows the server's sentence", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);
    api.bulkSheets.mockRejectedValue(
      new Error("A kijelölt munkalapok egyikének sincs kiadott PDF-je."),
    );
    await select();
    fireEvent.click(screen.getByRole("button", { name: "Nyomtatás" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "A kijelölt munkalapok egyikének sincs kiadott PDF-je.",
    );
    expect(tab.close).toHaveBeenCalled();
    open.mockRestore();
  });
});

/*
  A KIJELÖLT LAPOK MÁSOLÁSA (kártya a785e580; az API a #2746). MI PIROSÍT: a gomb nem a kijelölt lapokat küldi, vagy
  kérés-azonosító nélkül; egy elakadt kérés újrapróbálása ÚJ azonosítót kap (a szerver akkor második másolatot készít); a
  válasz után új másolás a régi azonosítóval megy (a szerver a régi másolatokat adná vissza, sikerként); a laponkénti
  eredményből hiányzik az új lap, a hiba mondata vagy a forrás neve; a kijelölés megmarad (egy második kattintás újra
  másolna); a lista nem frissül; partnerfióknak is megjelenik a gomb, pedig a szerver elutasítja.
*/
describe("PilotWorksheetListPage -- copy the selected sheets", () => {
  const twoRows = () =>
    response([
      row(),
      row({ id: "ws-2", number: "ML-2026-00815", subject: "Szűrőcsere" }),
    ]);

  const select = async () => {
    api.list.mockResolvedValue(twoRows());
    render(<PilotWorksheetListPage />);
    await screen.findAllByTestId("worksheet-row");
    fireEvent.click(
      screen.getByLabelText("Kijelölés: Tömítéscsere és ellenőrzés"),
    );
    fireEvent.click(screen.getByLabelText("Kijelölés: Szűrőcsere"));
  };

  it("copies the selected sheets and lists each: the new sheet, or why not", async () => {
    api.copy.mockResolvedValue({
      results: [
        { sourceId: "ws-1", ok: true, id: "ws-9", number: null },
        {
          sourceId: "ws-2",
          ok: false,
          message: "Lezárt hibajegyhez nem nyitható új munkalap.",
        },
      ],
    });
    await select();
    const listCalls = api.list.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Másolás" }));
    const results = await screen.findByRole("list", {
      name: "A másolás eredménye",
    });
    const [ids, requestId] = api.copy.mock.calls[0]!.slice(1) as [
      string[],
      string,
    ];
    expect(api.copy.mock.calls[0]![0]).toBe("token-1");
    expect(ids).toEqual(["ws-1", "ws-2"]);
    expect(requestId).toMatch(/^[A-Za-z0-9_.:-]{8,64}$/);
    expect(results.textContent).toContain(
      "Tömítéscsere és ellenőrzés: új piszkozat (még nincs száma)",
    );
    expect(
      screen
        .getByRole("link", { name: "új piszkozat (még nincs száma)" })
        .getAttribute("href"),
    ).toBe("/szerviz/munkalapok/ws-9");
    expect(results.textContent).toContain(
      "Szűrőcsere: Lezárt hibajegyhez nem nyitható új munkalap.",
    );
    expect(screen.getByRole("status").textContent).toBe(
      "1 munkalap másolata elkészült piszkozatként. 1 lapról nem készült másolat.",
    );
    expect(
      screen.queryByRole("region", { name: "Kijelölt munkalapok" }),
    ).toBeNull();
    await waitFor(() =>
      expect(api.list.mock.calls.length).toBeGreaterThan(listCalls),
    );
  });

  it("a retry after a lost answer reuses the request id; the next copy gets a new one", async () => {
    api.copy
      .mockRejectedValueOnce(new Error("A szerver nem válaszolt."))
      .mockResolvedValue({
        results: [
          { sourceId: "ws-1", ok: true, id: "ws-9", number: "ML-2026-00900" },
          { sourceId: "ws-2", ok: true, id: "ws-10", number: null },
        ],
      });
    await select();
    fireEvent.click(screen.getByRole("button", { name: "Másolás" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "A szerver nem válaszolt.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Másolás" }));
    await screen.findByRole("list", { name: "A másolás eredménye" });
    expect(
      screen.getByRole("link", { name: "új lap: ML-2026-00900" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText("Kijelölés: Tömítéscsere és ellenőrzés"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Másolás" }));
    await waitFor(() => expect(api.copy).toHaveBeenCalledTimes(3));
    const requestIds = api.copy.mock.calls.map((call) => call[2]);
    expect(requestIds[1]).toBe(requestIds[0]);
    expect(requestIds[2]).not.toBe(requestIds[1]);
  });

  it("a partner account does not get the button (the server refuses it)", async () => {
    auth.session = {
      ...sessionAs("ADMIN"),
      user: { ...sessionAs("ADMIN").user, customerId: "customer-1" },
    };
    await select();
    expect(screen.getByRole("button", { name: "Letöltés (zip)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Másolás" })).toBeNull();
  });
});
