import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VocabularyState } from "@/lib/api/knowledge-base";
import {
  VocabularyPage,
  formsOfText,
  parentChain,
  taxonTree,
} from "./vocabulary-page";

/**
 * SZAKMAI SZÓTÁRAK (S5, Figma 3:425). A taxonok fája, a kijelölt elem
 * szerkesztése a tervezetbe, új elem, a próbamondat, és a változat
 * jóváhagyása csak a jóváhagyó jogával (Balázsé).
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tudasbazis/szotar",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  vocabulary: vi.fn(),
  probeVocabulary: vi.fn(),
  addVocabularyEntry: vi.fn(),
  editVocabularyEntry: vi.fn(),
  approveVocabulary: vi.fn(),
}));
vi.mock("@/lib/api/knowledge-base", () => ({ knowledgeBaseApi: api }));

const auth = vi.hoisted(() => ({
  role: "OWNER" as UserRole,
  permissions: undefined as string[] | undefined,
}));
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

const taxon = (
  key: string,
  label: string,
  parentKey: string | null,
  rank: string,
) => ({
  kind: "TAXON",
  key,
  label,
  forms: [label.toLowerCase()],
  exactMatch: false,
  parentKey,
  rank,
  note: null,
});
const STATE: VocabularyState = {
  approved: { version: 1, origin: "CODE", approvedAt: null, approvedBy: null },
  draft: {
    version: 2,
    fingerprint: "f".repeat(64),
    changes: [
      {
        kind: "TAXON",
        key: "ACROPORA_MURICATA",
        change: "CHANGED",
        fields: ["forms"],
      },
    ],
  },
  entries: [
    taxon("CORAL", "Korall", null, "GROUP"),
    taxon("STONY_CORAL", "Kőkorall", "CORAL", "GROUP"),
    taxon("SPS", "SPS", "STONY_CORAL", "GROUP"),
    taxon("ACROPORA", "Acropora", "SPS", "GENUS"),
    taxon("ACROPORA_MURICATA", "Acropora muricata", "ACROPORA", "SPECIES"),
    {
      kind: "EFFECT",
      key: "GROWTH",
      label: "Növekedés",
      forms: ["növekedés"],
      exactMatch: false,
      parentKey: null,
      rank: null,
      note: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "OWNER";
  api.vocabulary.mockResolvedValue(STATE);
  api.editVocabularyEntry.mockResolvedValue(STATE);
  api.addVocabularyEntry.mockResolvedValue(STATE);
  api.approveVocabulary.mockResolvedValue({ ...STATE, draft: null });
  api.probeVocabulary.mockResolvedValue({
    version: 2,
    parts: {
      taxa: ["ACROPORA_MURICATA"],
      environments: [],
      effects: ["GROWTH"],
      verbDirections: [],
      negation: "AFFIRMATIVE",
      negationReason: null,
      certainty: [],
      scopePhrases: [],
      unsupported: [],
      quantities: [],
      unrecognisedNumbers: [],
    },
  });
});

describe("Szakmai szótárak", () => {
  it("a fa a szülők szerint, a kijelölt faj a kategóriájával; a mentés a tervezetbe megy", async () => {
    render(<VocabularyPage />);
    await screen.findByText("Taxonómia · fa-nézet");
    expect(screen.getByLabelText("Változat").textContent).toMatch(
      /Jóváhagyott változat: 1\..*Szerkesztés alatt: 2\. változat, 1 változással/,
    );
    const items = within(screen.getByLabelText("Szótár elemei")).getAllByRole(
      "button",
    );
    expect(items.map((b) => b.textContent)).toEqual([
      "Korall",
      "Kőkorall",
      "SPS",
      "Acropora",
      "Acropora muricatatervezet",
    ]);
    fireEvent.click(items[4]!);
    expect(screen.getByLabelText("Elfogadott név").textContent).toContain(
      "Acropora muricata",
    );
    expect(screen.getByText("Korall → Kőkorall → SPS → Acropora")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Felismert alakok"), {
      target: { value: "acropora muricata; acropora formosa" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mentés a tervezetbe" }),
    );
    await waitFor(() => expect(api.editVocabularyEntry).toHaveBeenCalled());
    expect(api.editVocabularyEntry.mock.calls[0]?.slice(1)).toEqual([
      "TAXON",
      "ACROPORA_MURICATA",
      { forms: ["acropora muricata", "acropora formosa"] },
    ]);
  });

  it("új hatás: a magyar alakokkal megy el", async () => {
    render(<VocabularyPage />);
    await screen.findByText("Taxonómia · fa-nézet");
    fireEvent.click(screen.getByRole("tab", { name: "Hatás" }));
    fireEvent.click(screen.getByRole("button", { name: "Új elem" }));
    fireEvent.change(screen.getByLabelText("Új elem alakjai"), {
      target: { value: "belső tápanyag-tartalék" },
    });
    fireEvent.change(screen.getByLabelText("Új elem kulcsa"), {
      target: { value: "INTERNAL_RESERVES" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Felvétel a tervezetbe" }),
    );
    await waitFor(() => expect(api.addVocabularyEntry).toHaveBeenCalled());
    expect(api.addVocabularyEntry.mock.calls[0]?.[1]).toEqual({
      kind: "EFFECT",
      forms: ["belső tápanyag-tartalék"],
      key: "INTERNAL_RESERVES",
    });
  });

  it("a próbamondat a felismert részeket a nevükkel mutatja", async () => {
    render(<VocabularyPage />);
    await screen.findByText("Taxonómia · fa-nézet");
    fireEvent.change(screen.getByLabelText("Próbamondat"), {
      target: { value: "Az Acropora muricata növekedése…" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Felismerés" }));
    const found = await screen.findByLabelText("Felismert részek");
    expect(found.textContent).toContain("Acropora muricata felismerve");
    expect(found.textContent).toContain("Hatás: Növekedés");
    expect(api.probeVocabulary.mock.calls[0]?.slice(1)).toEqual([
      "Az Acropora muricata növekedése…",
      "DRAFT",
    ]);
  });

  it("jóváhagyás: a jóváhagyó a látott változatot hagyja jóvá", async () => {
    render(<VocabularyPage />);
    await screen.findByText("Taxonómia · fa-nézet");
    fireEvent.click(
      screen.getByRole("button", { name: "Szótárváltozat jóváhagyása" }),
    );
    await waitFor(() =>
      expect(api.approveVocabulary).toHaveBeenCalledWith(
        "token-1",
        2,
        "f".repeat(64),
      ),
    );
  });

  it("a MANAGER olvas, de nem szerkeszt és nem hagy jóvá", async () => {
    auth.role = "MANAGER";
    render(<VocabularyPage />);
    await screen.findByText("Taxonómia · fa-nézet");
    expect(
      screen.queryByRole("button", { name: "Szótárváltozat jóváhagyása" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Új elem" })).toBeNull();
    expect(
      screen.getByText("A változat jóváhagyása a szerkesztőé (Balázs)."),
    ).toBeTruthy();
  });

  it("a tiszta segédek", () => {
    expect(formsOfText("a; b\nc;;")).toEqual(["a", "b", "c"]);
    expect(taxonTree(STATE.entries).map((t) => t.depth)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(parentChain(STATE.entries, STATE.entries[0]!)).toBe("");
  });
});
