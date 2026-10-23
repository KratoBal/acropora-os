import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeOverview } from "@/lib/api/knowledge-base";
import { KnowledgeOverviewPage } from "./knowledge-overview-page";

/**
 * A TUDÁSBÁZIS ÁTTEKINTŐJE (S4, Figma 3:2): a „Rád vár” sáv, a projekt
 * számai, a folyamat állása. Megnyitás-link csak kész képernyőre.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tudasbazis",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({ overview: vi.fn() }));
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

const OVERVIEW: KnowledgeOverview = {
  question: "Foszfát SPS-akváriumban",
  waiting: { sourcesToScreen: 38, claimsToCheck: 14, problems: 6 },
  project: {
    sources: 82,
    included: 24,
    acceptedClaims: 9,
    openChecks: 6,
    stage: "EXTRACTION",
  },
  stages: [
    { key: "DISCOVERY", state: "DONE" },
    { key: "SCREENING", state: "ACTIVE" },
    { key: "EXTRACTION", state: "ACTIVE" },
    { key: "CHECKING", state: "TODO" },
    { key: "CONCLUSION", state: "TODO" },
    { key: "ARTICLE", state: "TODO" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "OWNER";
  api.overview.mockResolvedValue(OVERVIEW);
});

describe("Tudásbázis áttekintő", () => {
  it("a Rád vár sáv: a szűrés és az ellenőrzés a saját képernyőjére visz, a problémák kártyája link nélkül áll", async () => {
    render(<KnowledgeOverviewPage />);
    const waiting = (
      await screen.findByRole("heading", { name: "Rád vár" })
    ).closest("section") as HTMLElement;
    expect(within(waiting).getByText("38")).toBeTruthy();
    expect(within(waiting).getByText("14")).toBeTruthy();
    const links = within(waiting).getAllByRole("link", { name: /Megnyitás/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/tudasbazis/forrasok",
      "/tudasbazis/kiolvasas",
    ]);
  });

  it("a projekt kártya és a folyamat: a kérdés, a szakasz, a négy szám, a hat lépés állapottal", async () => {
    render(<KnowledgeOverviewPage />);
    expect(
      await screen.findByRole("heading", { name: "Kutatási projektek" }),
    ).toBeTruthy();
    expect(
      screen.getAllByText("Foszfát SPS-akváriumban").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText("A befogadott publikációk kiolvasása folyamatban van."),
    ).toBeTruthy();
    expect(screen.getByText("82")).toBeTruthy();
    const steps = within(
      screen.getByRole("list", { name: "Kutatási folyamat" }),
    ).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual([
      "DONE",
      "ACTIVE",
      "ACTIVE",
      "TODO",
      "TODO",
      "TODO",
    ]);
    // no "new research question" button: nothing would stand behind it
    expect(
      screen.queryByRole("button", { name: /Új kutatási kérdés/ }),
    ).toBeNull();
  });

  it("jog nélkül nem kér semmit", async () => {
    auth.role = "SALES";
    render(<KnowledgeOverviewPage />);
    expect(await screen.findByText("Nincs jogosultság")).toBeTruthy();
    expect(api.overview).not.toHaveBeenCalled();
  });

  it("hiba: kimondja, és újrapróbálható", async () => {
    api.overview.mockRejectedValueOnce(new Error("HTTP 500"));
    render(<KnowledgeOverviewPage />);
    expect(
      await screen.findByText("Az áttekintő nem tölthető be"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Újra" }));
    expect(
      await screen.findByRole("heading", { name: "Rád vár" }),
    ).toBeTruthy();
  });

  it("betöltés közben egy státusz-jelzés áll", () => {
    api.overview.mockReturnValue(new Promise(() => undefined));
    render(<KnowledgeOverviewPage />);
    expect(screen.getByRole("status", { name: "Betöltés" })).toBeTruthy();
  });
});
