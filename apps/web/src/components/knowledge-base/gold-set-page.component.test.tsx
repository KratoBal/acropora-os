import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GoldRow, GoldSet, GoldSource } from "@/lib/api/knowledge-base";
import { GoldSetPage } from "./gold-set-page";

/*
  T3 GOLD SET (plan 10, T3). What turns this red: a row shown with a verdict
  other than the API's; a wrong quantity not named as a value, unit or basis
  error; a freeze or a missed-claim write offered to a role without
  knowledge.manage, or without its confirmation; a source marked complete
  that still takes missed claims; the score's missing parts not said.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tudasbazis/arany-keszlet",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  goldSet: vi.fn(),
  freezeGoldSet: vi.fn(),
  addGoldMissed: vi.fn(),
  removeGoldMissed: vi.fn(),
  setGoldCompleteness: vi.fn(),
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

const score = (over: Partial<GoldSet["score"]> = {}): GoldSet["score"] => ({
  rows: { total: 3, pending: 1, correct: 1, wrong: 1, out: 0 },
  precision: {
    scored: 2,
    correct: 1,
    wrong: 1,
    critical: 1,
    maxErrors: 0,
    wilsonLower: 0.09,
  },
  completeness: {
    found: 2,
    missed: 1,
    gold: 3,
    minFound: 3,
    wilsonLower: 0.21,
    sourcesChecked: 0,
  },
  verdict: "NOT_READY",
  problems: ["PENDING_ROWS", "TOO_FEW_SCORED", "COMPLETENESS_OPEN"],
  failures: [],
  sourceFields: {
    pending: 0,
    correct: 0,
    wrong: 1,
    none: 0,
    wrongFields: 1,
    maxErrors: 1,
    levelChanged: 1,
    verdict: "FAIL",
  },
  ...over,
});

const row = (
  claimId: string,
  judgement: Partial<GoldRow["judgement"]>,
): GoldRow => ({
  claimId,
  status: "VERIFIED",
  passage: { text: `Kivonat ${claimId}`, locator: "Results" },
  fields: [
    {
      field: "quantity",
      value: "2 µmol/l",
      correctedValue: null,
      decision: "REJECTED",
    },
  ],
  judgement: {
    verdict: "CORRECT",
    errors: [],
    critical: false,
    questions: [],
    outReason: null,
    found: true,
    ...judgement,
  },
});

const source = (over: Partial<GoldSource> = {}): GoldSource => ({
  sourceId: "src-1",
  position: 1,
  title: "Kitalált foszfát-cikk",
  year: 2022,
  doi: "10.5555/kitalalt",
  rows: [
    row("c-ok", {}),
    row("c-q", {
      verdict: "WRONG",
      errors: ["quantity"],
      critical: true,
    }),
    row("c-wait", { verdict: "PENDING", found: false }),
  ],
  missed: [
    {
      id: "m1",
      text: "PO4 0,02 mg/l alatt nőtt",
      locator: "2. tábla",
      createdAt: "2026-10-28T08:00:00.000Z",
    },
  ],
  completenessCheckedAt: null,
  notInSet: 6,
  sourceRow: {
    fields: [
      {
        field: "studyType",
        value: "CONTROLLED_LAB",
        correctedValue: null,
        decision: "REJECTED",
      },
    ],
    judgement: {
      verdict: "WRONG",
      errors: ["studyType"],
      questions: [],
      levelChanged: true,
    },
  },
  ...over,
});

const frozen = (over: Partial<GoldSet> = {}): GoldSet => ({
  frozen: true,
  frozenAt: "2026-10-28T08:00:00.000Z",
  sources: [source()],
  proposal: null,
  score: score(),
  ...over,
});

const proposal = (enough: boolean): GoldSet => ({
  frozen: false,
  frozenAt: null,
  sources: [],
  proposal: {
    sources: Array.from({ length: enough ? 8 : 2 }, (_, i) => ({
      sourceId: `p${i}`,
      title: `Javasolt cikk ${i}`,
      year: 2020,
      claims: i === 0 ? 12 : 4,
      inSet: i === 0 ? 6 : 4,
    })),
    claims: enough ? 34 : 10,
    required: { sources: 8, claims: 30, perSource: 6 },
    enough,
  },
  score: score({ problems: ["NOT_FROZEN"], verdict: "NOT_READY" }),
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "OWNER";
  api.goldSet.mockResolvedValue(frozen());
});

describe("GoldSetPage", () => {
  it("shows every row with the API's verdict, the wrong quantity named, the pending row sent to the review", async () => {
    render(<GoldSetPage />);
    const rows = await screen.findByRole("list", { name: "Gépi állítások" });
    expect(within(rows).getByText("Helyes")).toBeTruthy();
    expect(within(rows).getByText("Hibás")).toBeTruthy();
    expect(within(rows).getByText("Bírálatra vár")).toBeTruthy();
    expect(
      within(rows).getByText(/Mennyiség · érték-, egység- vagy bázishiba/),
    ).toBeTruthy();
    expect(
      within(rows).getByRole("link", { name: "Bírálat a Kiolvasás fülön" }),
    ).toBeTruthy();
  });

  it("says what is still missing, in words", async () => {
    render(<GoldSetPage />);
    const missing = await screen.findByRole("list", {
      name: "Ami még hiányzik",
    });
    expect(
      within(missing).getByText("1 sor bírálatra vár a Kiolvasás fülön."),
    ).toBeTruthy();
    expect(
      within(missing).getByText(
        "1 forrásnál még nincs kimondva, hogy nincs több kimaradt állítás.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Folyamatban")).toBeTruthy();
  });

  it("adds a missed claim with its place, and removes one only after the confirmation", async () => {
    api.addGoldMissed.mockResolvedValue(frozen());
    api.removeGoldMissed.mockResolvedValue(frozen());
    render(<GoldSetPage />);
    fireEvent.change(await screen.findByLabelText("Kimaradt állítás"), {
      target: { value: "  Új kimaradt állítás  " },
    });
    fireEvent.change(
      screen.getByLabelText("Hol áll (oldal, szakasz, táblázat)"),
      { target: { value: "Discussion" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Kimaradt állítás felvétele" }),
    );
    await waitFor(() =>
      expect(api.addGoldMissed).toHaveBeenCalledWith("token-1", "src-1", {
        text: "Új kimaradt állítás",
        locator: "Discussion",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    expect(api.removeGoldMissed).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Törlés" }));
    await waitFor(() =>
      expect(api.removeGoldMissed).toHaveBeenCalledWith("token-1", "m1"),
    );
  });

  it("a source marked complete takes no more missed claims, and can be reopened", async () => {
    api.goldSet.mockResolvedValue(
      frozen({
        sources: [
          source({ completenessCheckedAt: "2026-10-28T09:00:00.000Z" }),
        ],
      }),
    );
    api.setGoldCompleteness.mockResolvedValue(frozen());
    render(<GoldSetPage />);
    expect(await screen.findByText("Teljesség kimondva")).toBeTruthy();
    expect(screen.queryByLabelText("Kimaradt állítás")).toBeNull();
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Újranyitás" }));
    await waitFor(() =>
      expect(api.setGoldCompleteness).toHaveBeenCalledWith(
        "token-1",
        "src-1",
        false,
      ),
    );
  });

  it("before the freeze: the proposal, frozen only after the confirmation, with its ten ids", async () => {
    api.goldSet.mockResolvedValue(proposal(true));
    api.freezeGoldSet.mockResolvedValue(frozen());
    render(<GoldSetPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Készlet rögzítése" }),
    );
    expect(api.freezeGoldSet).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Rögzítés" }));
    await waitFor(() =>
      expect(api.freezeGoldSet).toHaveBeenCalledWith(
        "token-1",
        Array.from({ length: 8 }, (_, i) => `p${i}`),
      ),
    );
  });

  it("a proposal that is not enough says so and offers no freeze", async () => {
    api.goldSet.mockResolvedValue(proposal(false));
    render(<GoldSetPage />);
    expect(
      await screen.findByText("Ebből még nem áll össze a készlet"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Készlet rögzítése" }),
    ).toBeNull();
  });

  it("a MANAGER reads the sheet but gets no write", async () => {
    auth.role = "MANAGER";
    render(<GoldSetPage />);
    await screen.findByText("1. Kitalált foszfát-cikk");
    expect(screen.queryByLabelText("Kimaradt állítás")).toBeNull();
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Ebben a forrásban nincs több kimaradt állítás",
      }),
    ).toBeNull();
  });

  it("T3b: the source row and its score apart, with the level change named; the capped source says what is not in the set", async () => {
    render(<GoldSetPage />);
    const studyRow = await screen.findByLabelText("Vizsgálati mezők");
    expect(
      within(studyRow).getByText(
        /Vizsgálattípus · a bizonyítéki szintet megváltoztatja/,
      ),
    ).toBeTruthy();
    const apart = screen.getByRole("region", {
      name: "Forrás vizsgálati mezői",
    });
    expect(within(apart).getByText("Nem felel meg")).toBeTruthy();
    expect(
      screen.getByText(/A forrás további 6 gépi állítása nincs a készletben/),
    ).toBeTruthy();
  });

  it("the proposal says how many of a source's claims go into the set", async () => {
    api.goldSet.mockResolvedValue(proposal(true));
    render(<GoldSetPage />);
    expect(await screen.findByText("6 a 12 állításból")).toBeTruthy();
  });

  it("asks nothing without the right", async () => {
    auth.role = "SALES";
    render(<GoldSetPage />);
    expect(await screen.findByText("Nincs jogosultság")).toBeTruthy();
    expect(api.goldSet).not.toHaveBeenCalled();
  });
});
