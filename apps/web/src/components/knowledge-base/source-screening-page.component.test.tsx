import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeSourceRow } from "@/lib/api/knowledge-base";
import { SourceScreeningPage, sourceMeta } from "./source-screening-page";

/**
 * A FORRÁSSZŰRÉS (Research & Knowledge Engine S4, Figma 3:68). A szerkesztő
 * befogad vagy okkal kizár; a gombok csak a knowledge.manage joggal látszanak;
 * a kizárás okot kér, az „egyéb” megjegyzést; billentyűvel is megy.
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
  duplicatesRemoved: 7,
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
});

describe("Forrásszűrés", () => {
  it("a fejléc, a PRISMA-számláló és a döntésre váró lista; a visszavont piros jelet kap", async () => {
    render(<SourceScreeningPage />);
    expect(await screen.findByText("Kitalált cikk s1")).toBeTruthy();
    expect(screen.getByText("Szakirodalmi források")).toBeTruthy();
    expect(screen.getByText("Döntésre váró publikációk")).toBeTruthy();
    const counts = screen.getByLabelText("Szűrési napló");
    expect(within(counts).getByText("82")).toBeTruthy();
    expect(within(counts).getByText("7")).toBeTruthy();
    expect(screen.getByText("Visszavont")).toBeTruthy();
    // alapból a döntésre várókat kéri
    expect(api.sources.mock.calls[0]?.[1].get("status")).toBe("PENDING");
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
