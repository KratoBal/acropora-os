import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductManufacturerClaimsCard } from "./product-manufacturer-claims-card";

const api = vi.hoisted(() => ({
  forProduct: vi.fn(),
  create: vi.fn(),
  setStatus: vi.fn(),
  archive: vi.fn(),
  content: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/api/manufacturer-claims", () => ({ manufacturerClaimApi: api }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as string}</a>
  ),
}));

/* The answer arrives a macrotask later, on purpose (see the shipping card's test). */
const kesobb = <T,>(value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), 0));

const allitas = (overrides: Record<string, unknown> = {}) => ({
  id: "allitas-1",
  productId: "termek-1",
  productName: "Teszt adalék",
  brand: { id: "marka-1", name: "Gyártó" },
  claimType: "DOSING",
  claimText: "Napi 5 ml 100 literenként.",
  sourceKind: "LABEL",
  sourceRef: "https://gyarto.example.invalid/cimke",
  sourcePublishedOn: null,
  sourceReadOn: "2026-11-12",
  valueAmount: null,
  valueUnit: null,
  note: null,
  recheckOn: null,
  knowledgeFact: null,
  knowledgeFactRevision: null,
  knowledgeLink: "NONE",
  status: "UNVERIFIED",
  version: 1,
  recordedBy: { id: "masik", name: "Másik Kolléga" },
  recordedAt: "2026-11-12T08:00:00.000Z",
  verifiedBy: null,
  verifiedAt: null,
  archivedAt: null,
  archivedBy: null,
  output: {
    mode: "DRAFT_ONLY",
    effectiveStatus: "UNVERIFIED",
    attribution: "a gyártó szerint",
    placeholder: null,
    verbatimAllowed: true,
    checkRequiredBeforeSend: true,
    reasons: ["UNVERIFIED"],
  },
  ...overrides,
});

function card(
  props: Partial<{
    canManage: boolean;
    canApprove: boolean;
    currentUserId: string;
  }> = {},
) {
  return render(
    <ProductManufacturerClaimsCard
      token="t"
      productId="termek-1"
      canManage={props.canManage ?? true}
      canApprove={props.canApprove ?? false}
      currentUserId={props.currentUserId ?? "en"}
    />,
  );
}

describe("a termék gyártói állításai (T5.3)", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.forProduct.mockImplementation(() =>
      kesobb({ items: [allitas()], truncated: false }),
    );
  });

  it("mutatja az állítást, a jelölést, az állapotot, és hogy miért nem írható ki", async () => {
    card();
    const sor = await screen.findByTestId("manufacturer-claim-allitas-1");
    expect(within(sor).getByText(/Napi 5 ml/)).toBeTruthy();
    expect(within(sor).getByText("(a gyártó szerint)")).toBeTruthy();
    expect(within(sor).getByText("Ellenőrizetlen")).toBeTruthy();
    expect(within(sor).getByText("Csak vázlatba")).toBeTruthy();
    expect(within(sor).getByText(/kiküldés előtt kötelező/)).toBeTruthy();
  });

  it("más állítását ellenőrizheti; független megerősítés csak jóváhagyási joggal", async () => {
    card();
    const sor = await screen.findByTestId("manufacturer-claim-allitas-1");
    expect(
      within(sor).getByText("Gyártói forrással egyezik", {
        selector: "button",
      }),
    ).toBeTruthy();
    expect(
      within(sor).queryByText("Független forrással megerősítve"),
    ).toBeNull();
    api.setStatus.mockResolvedValue(allitas());
    fireEvent.click(
      within(sor).getByText("Gyártói forrással egyezik", {
        selector: "button",
      }),
    );
    await waitFor(() =>
      expect(api.setStatus).toHaveBeenCalledWith(
        "t",
        "allitas-1",
        1,
        "MATCHES_MANUFACTURER",
      ),
    );
  });

  it("jóváhagyási joggal megjelenik a független megerősítés", async () => {
    card({ canApprove: true });
    const sor = await screen.findByTestId("manufacturer-claim-allitas-1");
    expect(
      within(sor).getByText("Független forrással megerősítve", {
        selector: "button",
      }),
    ).toBeTruthy();
  });

  it("a saját állításán nincs ellenőrző gomb (a szerver is elutasítaná)", async () => {
    card({ currentUserId: "masik", canApprove: true });
    const sor = await screen.findByTestId("manufacturer-claim-allitas-1");
    expect(
      within(sor).queryByText("Gyártói forrással egyezik", {
        selector: "button",
      }),
    ).toBeNull();
    expect(
      within(sor).queryByText("Eltér / vitatott", { selector: "button" }),
    ).toBeNull();
    expect(
      within(sor).queryByText("Független forrással megerősítve", {
        selector: "button",
      }),
    ).toBeNull();
  });

  it("megváltozott Product Knowledge mellett nem ad ellenőrzött állapotot, csak vitatottat", async () => {
    api.forProduct.mockImplementation(() =>
      kesobb({
        items: [allitas({ knowledgeLink: "CHANGED" })],
        truncated: false,
      }),
    );
    card({ canApprove: true });
    const sor = await screen.findByTestId("manufacturer-claim-allitas-1");
    expect(
      within(sor).queryByText("Gyártói forrással egyezik", {
        selector: "button",
      }),
    ).toBeNull();
    expect(
      within(sor).getByText("Eltér / vitatott", { selector: "button" }),
    ).toBeTruthy();
  });

  it("írási jog nélkül csak olvas", async () => {
    card({ canManage: false });
    const sor = await screen.findByTestId("manufacturer-claim-allitas-1");
    expect(within(sor).queryByText("Archiválás")).toBeNull();
    expect(screen.queryByText("Új állítás")).toBeNull();
  });

  it("új állítás: a szám mértékegység nélkül nem megy el", async () => {
    card();
    await screen.findByTestId("manufacturer-claim-allitas-1");
    fireEvent.click(screen.getByText("Új állítás"));
    fireEvent.change(screen.getByLabelText("Az állítás"), {
      target: { value: "Gyorsítja a növekedést." },
    });
    fireEvent.change(screen.getByLabelText("Forrás"), {
      target: { value: "https://gyarto.example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Szám-érték"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByText("Mentés"));
    expect(await screen.findByText(/csak együtt adható meg/)).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Mértékegység"), {
      target: { value: "ml" },
    });
    api.create.mockResolvedValue(allitas());
    fireEvent.click(screen.getByText("Mentés"));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        "t",
        "termek-1",
        expect.objectContaining({
          claimText: "Gyorsítja a növekedést.",
          valueAmount: 5,
          valueUnit: "ml",
        }),
      ),
    );
  });

  it("az érintett tartalmak listája a cikket a szerkesztőre linkeli", async () => {
    api.content.mockResolvedValue({
      items: [
        {
          id: "cikk-1",
          title: "Adagolási cikk",
          channel: "ARTICLE",
          state: "AWAITING_APPROVAL",
          plannedFor: null,
          scheduledFor: null,
          sentAt: null,
          linkedAt: "2026-11-12T08:00:00.000Z",
        },
      ],
    });
    card();
    const sor = await screen.findByTestId("manufacturer-claim-allitas-1");
    fireEvent.click(within(sor).getByText("Érintett tartalmak"));
    const link = await within(sor).findByText("Adagolási cikk");
    expect(link.getAttribute("href")).toBe("/tartalom/cikk-1/cikk");
  });
});
