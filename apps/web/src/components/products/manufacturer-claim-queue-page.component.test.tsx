import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManufacturerClaimQueuePage } from "./manufacturer-claim-queue-page";

const api = vi.hoisted(() => ({ list: vi.fn() }));
let role = "OWNER";

vi.mock("@/lib/api/manufacturer-claims", () => ({ manufacturerClaimApi: api }));
// the page stands under `PilotThemeRoot` (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "t",
      user: { id: "en", email: "en@acropora.local", role },
    },
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as string}</a>
  ),
}));

const allitas = (id: string, claimType: string) => ({
  id,
  productId: `termek-${id}`,
  productName: `Termék ${id}`,
  brand: null,
  claimType,
  claimText: `Állítás ${id}`,
  sourceKind: "LABEL",
  sourceRef: "https://gyarto.example.invalid",
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
  recordedBy: { id: "masik", name: "Másik" },
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
    checkRequiredBeforeSend: claimType === "DOSING",
    reasons: ["UNVERIFIED"],
  },
});

describe("a gyártói állítások sora (T5.3, 4. pont)", () => {
  beforeEach(() => {
    role = "OWNER";
    api.list.mockReset().mockResolvedValue({
      items: [allitas("a", "DOSING"), allitas("b", "EFFECT")],
      truncated: false,
    });
  });

  it("alapból az ellenőrzésre várókat kéri, a szerver sorrendjében, a termékre linkelve", async () => {
    render(<ManufacturerClaimQueuePage />);
    await screen.findByTestId("claim-queue-a");
    expect(api.list).toHaveBeenCalledWith("t", { status: "UNVERIFIED" });
    const ids = screen
      .getAllByTestId(/claim-queue-/)
      .map((element) => element.getAttribute("data-testid"));
    expect(ids).toEqual(["claim-queue-a", "claim-queue-b"]);
    expect(screen.getByText("Termék a").getAttribute("href")).toBe(
      "/products/termek-a",
    );
  });

  it("a kapcsolóval az egész lista jön", async () => {
    render(<ManufacturerClaimQueuePage />);
    await screen.findByTestId("claim-queue-a");
    fireEvent.click(screen.getByLabelText("Csak az ellenőrzésre várók"));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith("t", {}));
  });

  it("csonka listánál kimondja", async () => {
    api.list.mockResolvedValue({
      items: [allitas("a", "DOSING")],
      truncated: true,
    });
    render(<ManufacturerClaimQueuePage />);
    expect(await screen.findByText("A lista nem teljes")).toBeTruthy();
  });

  it("content.view nélkül nem kér semmit", async () => {
    role = "PARTNER_SERVICE";
    render(<ManufacturerClaimQueuePage />);
    expect(
      await screen.findByText("Nincs hozzáférésed a tartalmakhoz"),
    ).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });
});
