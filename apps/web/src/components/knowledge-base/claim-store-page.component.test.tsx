import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClaimStoreDetail,
  ClaimStoreItem,
  ClaimStoreList,
} from "@/lib/api/knowledge-base";
import { ClaimDetailPage, ClaimStorePage } from "./claim-store-page";

/**
 * ÁLLÍTÁS-TÁR (S5, Figma 3:229): az ellenőrzött állítások rétegek szerint, a
 * levezetett címmel és bizonyíték-szinttel; az üres tár kimondja, mi tölti
 * meg; a részletes nézet a bizonyítékot a szó szerinti kivonattal és a
 * kapcsolatokat mutatja.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tudasbazis/allitasok",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  claimStore: vi.fn(),
  claimDetail: vi.fn(),
  withdrawClaim: vi.fn(),
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

const LAYERS = {
  SCIENTIFIC: 1,
  HOBBY_EXPERIENCE: 0,
  MANUFACTURER: 0,
  OWN_CONCLUSION: 0,
};

const CLAIM: ClaimStoreItem = {
  id: "c1",
  layer: "SCIENTIFIC",
  status: "VERIFIED",
  title: "Vázsűrűség: csökken, 1–3 µmol/l PO₄ mellett",
  effect: { key: "SKELETAL_DENSITY", label: "Vázsűrűség" },
  direction: "DECREASE",
  quantity: "1–3 µmol/l PO₄",
  species: [{ key: "ACROPORA_MURICATA", label: "Acropora muricata" }],
  sources: [{ id: "s1", title: "Kitalált cikk", year: 2012, retracted: false }],
  evidenceLevel: {
    level: "SINGLE_EXPERIMENT",
    reasons: [],
    rulesVersion: "evidence-rules-v0-draft",
  },
  controlled: true,
  sampleSize: { value: 6, unit: "kolónia" },
  revision: 1,
  updatedAt: "2026-10-23T20:00:00.000Z",
};

const EMPTY: ClaimStoreList = {
  claims: [],
  total: 0,
  layers: { ...LAYERS, SCIENTIFIC: 0 },
};

const DETAIL: ClaimStoreDetail = {
  ...CLAIM,
  evidence: [
    {
      id: "e1",
      stance: "SUPPORTS",
      source: {
        id: "s1",
        title: "Kitalált cikk",
        year: 2012,
        retracted: false,
        doi: "10.5555/x",
        url: null,
        studyType: "CONTROLLED_LAB",
        controlled: true,
      },
      passage: {
        text: "Skeletal density decreased at 1-3 µmol/l phosphate.",
        locator: "Results",
        verifiedVerbatim: true,
      },
      species: CLAIM.species,
      environment: null,
      sampleSize: { value: 6, unit: "kolónia" },
      uncertainty: null,
      conditions: null,
      applicability: { value: "LIMITED", reason: "Terepi zátony" },
      anchors: [
        {
          field: "effect",
          value: "SKELETAL_DENSITY",
          decision: "ACCEPTED",
          passage: { text: "Skeletal density", locator: "Results" },
        },
      ],
    },
  ],
  relationsFrom: [],
  relationsTo: [
    {
      kind: "CONTRADICTS",
      note: null,
      claim: {
        id: "c2",
        title: "Vázsűrűség: nem változik",
        status: "VERIFIED",
        layer: "HOBBY_EXPERIENCE",
      },
    },
  ],
  validFrom: null,
  validUntil: null,
  createdAt: "2026-10-23T19:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "OWNER";
  api.claimStore.mockResolvedValue({
    claims: [CLAIM],
    total: 1,
    layers: LAYERS,
  } satisfies ClaimStoreList);
  api.claimDetail.mockResolvedValue(DETAIL);
});

describe("Állítás-tár", () => {
  it("a sor: réteg, levezetett cím a részletre mutató linkkel, faj és forrás, bizonyíték-szint", async () => {
    render(<ClaimStorePage />);
    const link = await screen.findByRole("link", { name: CLAIM.title });
    expect(link.getAttribute("href")).toBe("/tudasbazis/allitasok/c1");
    const row = link.closest("li") as HTMLElement;
    expect(within(row).getByText("Tudományos")).toBeTruthy();
    expect(
      within(row).getByText("Acropora muricata · Kitalált cikk, 2012"),
    ).toBeTruthy();
    expect(within(row).getByText("Kontrollált kísérlet")).toBeTruthy();
    expect(within(row).getByText("n = 6 kolónia")).toBeTruthy();
    expect(api.claimStore).toHaveBeenCalledWith(
      "token-1",
      null,
      expect.anything(),
    );
  });

  it("a rétegszűrő a szerverre megy, és az üres réteget megnevezi", async () => {
    render(<ClaimStorePage />);
    await screen.findByRole("link", { name: CLAIM.title });
    api.claimStore.mockResolvedValueOnce(EMPTY);
    fireEvent.click(screen.getByRole("button", { name: /^Tapasztalat/ }));
    expect(
      await screen.findByText(
        "Ebben a rétegben (Tapasztalat) még nincs ellenőrzött állítás.",
      ),
    ).toBeTruthy();
    expect(api.claimStore).toHaveBeenLastCalledWith(
      "token-1",
      "HOBBY_EXPERIENCE",
      expect.anything(),
    );
    expect(
      screen
        .getByRole("button", { name: /^Tapasztalat/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("az üres tár kimondja, mi tölti meg (a teszten még nincs ellenőrzött állítás)", async () => {
    api.claimStore.mockResolvedValue(EMPTY);
    render(<ClaimStorePage />);
    expect(
      await screen.findByText(/Még nincs ellenőrzött állítás\./),
    ).toBeTruthy();
  });

  it("jog nélkül nem kér semmit", async () => {
    auth.role = "SALES";
    render(<ClaimStorePage />);
    expect(await screen.findByText("Nincs jogosultság")).toBeTruthy();
    expect(api.claimStore).not.toHaveBeenCalled();
  });

  it("hiba: kimondja, és újrapróbálható", async () => {
    api.claimStore.mockRejectedValueOnce(new Error("HTTP 500"));
    render(<ClaimStorePage />);
    expect(
      await screen.findByText("Az állítás-tár nem tölthető be"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Újra" }));
    expect(await screen.findByRole("link", { name: CLAIM.title })).toBeTruthy();
  });
});

describe("Állítás részletei", () => {
  it("a bizonyíték a szó szerinti kivonattal, a forrás jellemzőivel és az alkalmazhatósággal", async () => {
    render(<ClaimDetailPage claimId="c1" />);
    expect(
      await screen.findByText(DETAIL.evidence[0]!.passage.text, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(api.claimDetail).toHaveBeenCalledWith(
      "token-1",
      "c1",
      expect.anything(),
    );
    expect(screen.getByText("Alátámasztja")).toBeTruthy();
    expect(
      screen.getByText(
        "Kísérlet · kontrollcsoporttal · n = 6 kolónia · DOI 10.5555/x",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Csak korlátozottan: Terepi zátony")).toBeTruthy();
    // the effect is shown by its label, never by its raw key
    expect(screen.getByText("Vázsűrűség")).toBeTruthy();
    expect(screen.queryByText("SKELETAL_DENSITY")).toBeNull();
  });

  it("a kapcsolat a másik állításra mutat, irány szerinti felirattal", async () => {
    render(<ClaimDetailPage claimId="c1" />);
    const link = await screen.findByRole("link", {
      name: "Vázsűrűség: nem változik",
    });
    expect(link.getAttribute("href")).toBe("/tudasbazis/allitasok/c2");
    expect(
      within(link.closest("li") as HTMLElement).getByText("Ellentmond neki"),
    ).toBeTruthy();
  });

  it("visszavonás: knowledge.manage joggal, kötelező indokkal, utána újratölt és Visszavonva (acrobot 35960)", async () => {
    api.withdrawClaim.mockResolvedValue({ id: "c1", status: "WITHDRAWN" });
    render(<ClaimDetailPage claimId="c1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Állítás visszavonása" }),
    );
    const save = screen.getByRole("button", { name: "Visszavonás mentése" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    api.claimDetail.mockResolvedValueOnce({ ...DETAIL, status: "WITHDRAWN" });
    fireEvent.change(screen.getByLabelText("Visszavonás oka"), {
      target: { value: " fényhatás, nem foszfát " },
    });
    fireEvent.click(save);
    expect(await screen.findByText("Visszavonva")).toBeTruthy();
    expect(api.withdrawClaim).toHaveBeenCalledWith(
      "token-1",
      "c1",
      "fényhatás, nem foszfát",
    );
    // a withdrawn claim offers no second withdrawal
    expect(
      screen.queryByRole("button", { name: "Állítás visszavonása" }),
    ).toBeNull();
  });

  it("visszavonás: knowledge.manage nélkül nincs gomb", async () => {
    auth.role = "MANAGER";
    render(<ClaimDetailPage claimId="c1" />);
    await screen.findByText(DETAIL.evidence[0]!.passage.text, { exact: false });
    expect(
      screen.queryByRole("button", { name: "Állítás visszavonása" }),
    ).toBeNull();
  });
});
