import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaimReview, ClaimReviewField } from "@/lib/api/knowledge-base";
import {
  ClaimReviewPage,
  quantityLabel,
  reviewErrorText,
} from "./claim-review-page";

/**
 * ÁLLÍTÁS ELLENŐRZÉSE (S4, Figma 3:137). Mezőnként elfogad / javít / elvet;
 * a mentés csak akkor él, ha minden mező döntött; a szótáron kívüli érték nem
 * fogadható el változatlanul; a mezőre kattintva a horgony kiemelődik.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tudasbazis/kiolvasas",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  vocabulary: vi.fn(),
  reviewQueue: vi.fn(),
  claimReview: vi.fn(),
  saveClaimReview: vi.fn(),
  discardClaim: vi.fn(),
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

const PASSAGE =
  "Calcification decreased by 18 % at 2 µM phosphate compared with the control (± 3.1 SE).";

const field = (
  anchorId: string,
  name: string,
  value: string | null,
  anchor: string,
  over: Partial<ClaimReviewField> = {},
): ClaimReviewField => ({
  anchorId,
  field: name,
  owner: "CLAIM",
  value,
  question: null,
  anchor: { text: anchor, locator: "Results" },
  decision: "PENDING",
  correctedValue: null,
  ...over,
});

const REVIEW: ClaimReview = {
  id: "c1",
  status: "CANDIDATE",
  source: {
    id: "s1",
    title: "Kitalált foszfát-kísérlet",
    year: 2021,
    doi: "10.5555/x",
    url: null,
    retracted: false,
    corrected: false,
    retractionUnchecked: false,
  },
  passage: { text: PASSAGE, locator: "Results" },
  fields: [
    field(
      "a1",
      "species",
      "ACROPORA_MILLEPORA",
      "Colonies of Acropora millepora (n = 12)",
      {
        anchor: {
          text: "Colonies of Acropora millepora (n = 12)",
          locator: "Methods",
        },
      },
    ),
    field("a2", "species", null, "Porites lutea colonies were not tested.", {
      question: "Porites lutea",
    }),
    field("a3", "quantity", "2-2 µmol/l", "at 2 µM phosphate"),
    field("a4", "effect", "CALCIFICATION", "Calcification decreased"),
    field("a5", "direction", "DECREASE", "Calcification decreased by 18 %"),
    field("a6", "studyType", "CONTROLLED_LAB", "compared with the control", {
      owner: "SOURCE",
    }),
  ],
  quantity: {
    min: "2",
    max: "2",
    unit: "µmol/l",
    basis: null,
    normalizedMinMgL: "0.189942",
    normalizedMaxMgL: "0.189942",
  },
  applicability: null,
  options: {
    species: [
      { key: "ACROPORA_MILLEPORA", label: "Acropora millepora" },
      { key: "PORITES", label: "Porites" },
    ],
    environment: [{ key: "LAB", label: "Labor" }],
    effect: [{ key: "CALCIFICATION", label: "Kalcifikáció" }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "OWNER";
  api.reviewQueue.mockResolvedValue({ ids: ["c1", "c2"], total: 2 });
  api.claimReview.mockResolvedValue(REVIEW);
  api.saveClaimReview.mockResolvedValue({ ...REVIEW, status: "VERIFIED" });
  api.discardClaim.mockResolvedValue({ ...REVIEW, status: "WITHDRAWN" });
});

const row = (name: string, index = 0) =>
  document.querySelectorAll<HTMLElement>(`li[data-field="${name}"]`)[index]!;
const click = (name: string, action: string, index = 0) =>
  fireEvent.click(
    within(row(name, index)).getByRole("button", {
      name: new RegExp(`: ${action}$`),
    }),
  );
const saveButton = () =>
  screen.getByRole("button", { name: "Állítás mentése" }) as HTMLButtonElement;

async function decideAll() {
  click("species", "elfogad", 0);
  click("species", "elvet", 1);
  for (const f of ["quantity", "effect", "direction", "studyType"])
    click(f, "elfogad");
}

describe("Állítás ellenőrzése", () => {
  it("a fejléc, a sorszám, a forrás szöveghelye és a mezők; a szótáron kívüli érték nem fogadható el", async () => {
    render(<ClaimReviewPage />);
    expect(await screen.findByText("Kitalált foszfát-kísérlet")).toBeTruthy();
    expect(screen.getByText("Állítás ellenőrzése")).toBeTruthy();
    expect(screen.getByText(/Állítás 01\/02/)).toBeTruthy();
    expect(screen.getByLabelText("Forrásszöveg").textContent).toBe(PASSAGE);
    expect(row("species").textContent).toContain("Acropora millepora");
    expect(row("quantity").textContent).toContain("2 µmol/l");
    expect(row("quantity").textContent).toContain("≈ 0,189942 mg/l PO₄");
    expect(row("studyType").textContent).toContain("(a forrásé)");
    expect(row("species", 1).textContent).toContain(
      "Ismeretlen érték: „Porites lutea”",
    );
    const accept = within(row("species", 1)).getByRole("button", {
      name: /elfogad$/,
    }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    expect(screen.getByText("Bizonyíték: Kísérlet")).toBeTruthy();
  });

  it("a mentés csak minden mező döntése után él, és a döntéseket küldi; utána a sor újratölt", async () => {
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(/Hátra van: 6/)).toBeTruthy();
    await decideAll();
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.saveClaimReview).toHaveBeenCalledWith("token-1", "c1", {
        decisions: [
          { anchorId: "a1", decision: "ACCEPT" },
          { anchorId: "a2", decision: "REJECT" },
          { anchorId: "a3", decision: "ACCEPT" },
          { anchorId: "a4", decision: "ACCEPT" },
          { anchorId: "a5", decision: "ACCEPT" },
          { anchorId: "a6", decision: "ACCEPT" },
        ],
        applicability: null,
      }),
    );
    await waitFor(() => expect(api.reviewQueue).toHaveBeenCalledTimes(2));
  });

  it("javítás: a kérdés egy ismert fajra, a mennyiség új számra; a javított érték megy el", async () => {
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    await decideAll();
    click("species", "javít", 1);
    fireEvent.change(within(row("species", 1)).getByLabelText("Helyes érték"), {
      target: { value: "PORITES" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Javítás rögzítése" }));
    expect(row("species", 1).textContent).toContain("Porites");
    expect(row("species", 1).textContent).toContain("javítva");

    click("quantity", "javít");
    fireEvent.change(within(row("quantity")).getByLabelText("Felső határ"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Javítás rögzítése" }));
    expect(row("quantity").textContent).toContain("legalább 2 µmol/l");

    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveClaimReview).toHaveBeenCalled());
    const sent = api.saveClaimReview.mock.calls[0]?.[2].decisions;
    expect(sent[1]).toEqual({
      anchorId: "a2",
      decision: "CORRECT",
      value: "PORITES",
    });
    expect(sent[2]).toEqual({
      anchorId: "a3",
      decision: "CORRECT",
      value: { min: 2, max: null, unit: "µmol/l", basis: null },
    });
  });

  it("felveszem a szótárba: a hiányzó faj a nemzetségével megy el, és a mező döntöttnek számít (S5)", async () => {
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    await decideAll();
    // only the question field offers it
    expect(
      within(row("species", 0)).queryByRole("button", {
        name: /felveszem a szótárba/,
      }),
    ).toBeNull();
    click("species", "felveszem a szótárba", 1);
    const editor = screen.getByLabelText("Felvétel a szótárba");
    expect(
      (within(editor).getByLabelText("Szótár-alakok") as HTMLInputElement)
        .value,
    ).toBe("porites lutea");
    expect(
      (within(editor).getByLabelText("Szülő") as HTMLSelectElement).value,
    ).toBe("PORITES");
    fireEvent.click(
      within(editor).getByRole("button", { name: "Felveszem és elfogadom" }),
    );
    expect(row("species", 1).textContent).toContain(
      "szótárba felvéve (tervezet)",
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveClaimReview).toHaveBeenCalled());
    expect(api.saveClaimReview.mock.calls[0]?.[2].decisions[1]).toEqual({
      anchorId: "a2",
      decision: "ADD_TO_VOCABULARY",
      entry: {
        forms: ["porites lutea"],
        rank: "SPECIES",
        parentKey: "PORITES",
      },
    });
  });

  it("felveszem a szótárba, hatás: magyar nevet kér, a gép szava a kulcs", async () => {
    api.claimReview.mockResolvedValue({
      ...REVIEW,
      fields: [
        ...REVIEW.fields.filter((f) => f.field !== "effect"),
        field("a7", "effect", null, "microbiome composition shifted", {
          question: "MICROBIOMECOMPOSITION",
        }),
      ],
    });
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    click("effect", "felveszem a szótárba");
    const editor = screen.getByLabelText("Felvétel a szótárba");
    const submit = within(editor).getByRole("button", {
      name: "Felveszem és elfogadom",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(editor).getByLabelText("Szótár-alakok"), {
      target: { value: "mikrobiom-összetétel; mikrobiom összetétele" },
    });
    fireEvent.click(submit);
    expect(row("effect").textContent).toContain("Mikrobiom-összetétel");
    expect(row("effect").textContent).not.toContain("MICROBIOMECOMPOSITION");
  });

  it("a szerver elutasítása a szerkesztő szavaival jelenik meg", async () => {
    api.saveClaimReview.mockRejectedValueOnce(
      new Error("quantity: NUMBER_NOT_AT_UNIT"),
    );
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    await decideAll();
    fireEvent.click(saveButton());
    expect(
      await screen.findByText(
        "Mennyiség: a szám nem közvetlenül az egység előtt áll a horgonyban.",
      ),
    ).toBeTruthy();
    expect(api.reviewQueue).toHaveBeenCalledTimes(1);
  });

  it("a mezőre kattintva a horgony kiemelődik: a szöveghelyen belül, vagy külön blokkban a saját szakaszával", async () => {
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    fireEvent.click(
      within(row("effect")).getByRole("button", { name: /horgony mutatása/ }),
    );
    const mark = screen.getByLabelText("Forrásszöveg").querySelector("mark");
    expect(mark?.textContent).toBe("Calcification decreased");
    fireEvent.click(
      within(row("species")).getByRole("button", { name: /horgony mutatása/ }),
    );
    const anchor = screen.getByLabelText("Horgony");
    expect(anchor.textContent).toContain("Faj horgonya · Methods");
    expect(anchor.textContent).toContain(
      "Colonies of Acropora millepora (n = 12)",
    );
  });

  it("az otthoni akváriumra vonatkozó döntés okot kér, és vele együtt megy el", async () => {
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    await decideAll();
    fireEvent.change(screen.getByLabelText("Otthoni akváriumra"), {
      target: { value: "LIMITED" },
    });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Indoklás"), {
      target: { value: "laborkísérlet" },
    });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.saveClaimReview.mock.calls[0]?.[2].applicability).toEqual({
        value: "LIMITED",
        reason: "laborkísérlet",
      }),
    );
  });

  it("elvetés: okot kér, és az okkal megy el", async () => {
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    fireEvent.click(screen.getByRole("button", { name: "Állítás elvetése" }));
    const confirm = screen.getByRole("button", {
      name: "Elvetés mentése",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Elvetés oka"), {
      target: { value: "édesvízi faj" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.discardClaim).toHaveBeenCalledWith(
        "token-1",
        "c1",
        "édesvízi faj",
      ),
    );
  });

  it("a forráson már eldöntött mező nem kér újra döntést", async () => {
    api.claimReview.mockResolvedValue({
      ...REVIEW,
      fields: REVIEW.fields.map((f) =>
        f.field === "studyType" ? { ...f, decision: "ACCEPTED" as const } : f,
      ),
    });
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    expect(row("studyType").textContent).toContain("A forráson már eldöntve");
    expect(
      within(row("studyType")).queryByRole("button", { name: /elfogad$/ }),
    ).toBeNull();
    expect(screen.getByText(/Hátra van: 5/)).toBeTruthy();
  });

  it("a MANAGER olvas, de döntés-gombot nem lát", async () => {
    auth.role = "MANAGER";
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    expect(screen.queryByRole("button", { name: /: elfogad$/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Állítás mentése" }),
    ).toBeNull();
  });

  it("üres sor: megmondja, mi kell hozzá", async () => {
    api.reviewQueue.mockResolvedValue({ ids: [], total: 0 });
    render(<ClaimReviewPage />);
    expect(
      await screen.findByText("Nincs ellenőrzésre váró állítás"),
    ).toBeTruthy();
    expect(api.claimReview).not.toHaveBeenCalled();
  });

  it("jog nélkül nem kér semmit", async () => {
    auth.role = "SALES";
    render(<ClaimReviewPage />);
    expect(await screen.findByText("Nincs jogosultság")).toBeTruthy();
    expect(api.reviewQueue).not.toHaveBeenCalled();
  });

  it("a mennyiség és a hibaüzenet szövege", () => {
    expect(quantityLabel("0.5", "2", "mg/l", "PO4")).toBe("0,5–2 mg/l PO₄");
    expect(quantityLabel(null, 2, "ppm", "P")).toBe("legfeljebb 2 ppm P");
    expect(reviewErrorText("species: NOT_A_KNOWN_ANCHORED_VALUE")).toBe(
      "Faj: ezt az értéket a horgony szövege nem nevezi meg, vagy nincs a szótárban.",
    );
    expect(
      reviewErrorText(
        "the effect and the direction must stay; otherwise discard the claim",
      ),
    ).toMatch(/^A hatás és az irány/);
    expect(
      reviewErrorText(
        "direction: two anchors propose this field and the claim holds the other's value; correct or reject this one",
      ),
    ).toBe(
      "Irány: két horgony javasol értéket erre a mezőre, és az állítás a másikét tartja. Ezt javítsd vagy vesd el.",
    );
    expect(
      reviewErrorText("quantity: the claim no longer holds this value"),
    ).toBe("Mennyiség: az állítás közben megváltozott. Töltsd be újra.");
  });

  it("visszavont forrás: az állítás nem menthető, csak elvethető", async () => {
    api.claimReview.mockResolvedValue({
      ...REVIEW,
      source: { ...REVIEW.source, retracted: true },
    });
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    await decideAll();
    expect(screen.getByText("Visszavont forrás")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(
      screen.getByRole("button", { name: "Állítás elvetése" }),
    ).toBeTruthy();
    expect(
      reviewErrorText(
        "the source was retracted: a claim on it can only be discarded",
      ),
    ).toMatch(/^A forrást visszavonták/);
  });

  it("nem ellenőrzött visszavonás: figyelmeztet az elfogadásnál, de menthető", async () => {
    api.claimReview.mockResolvedValue({
      ...REVIEW,
      source: { ...REVIEW.source, retractionUnchecked: true },
    });
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    expect(screen.getByRole("note").textContent).toMatch(
      /A visszavonás ennél a forrásnál nincs ellenőrizve/,
    );
    await decideAll();
    expect(saveButton().disabled).toBe(false);
  });

  it("ellenőrzött, nem visszavont forrásnál nincs figyelmeztetés", async () => {
    render(<ClaimReviewPage />);
    await screen.findByText("Kitalált foszfát-kísérlet");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText("Visszavont forrás")).toBeNull();
  });
});
