import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listForPartnerOrder: vi.fn(),
  issueForPartnerOrder: vi.fn(),
  uploadSignedDocument: vi.fn(),
  downloadDocument: vi.fn(),
}));
vi.mock("@/lib/api/completion-certificates", () => ({
  completionCertificatesApi: api,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { token: "token-1" } }),
}));

import {
  PartnerOrderCertificatesPanel,
  remainingQuantities,
} from "./partner-order-certificates-panel";

/*
  A MEGRENDELÉS TIG-PANELJE (Megrendelések S2). MI PIROSÍT: ha a hátralévő nem a
  korábbi TIG-sorokból számolt (vagy lebegőpontosan tévedő); ha a mennyiség nem
  a hátralévőről indul; ha a kérés nem a szerkesztett mennyiséget küldi; ha a
  nulla mennyiségű tétel bekerül; ha a kész megrendelés is gombot kínál.
*/
const items = [
  { quoteItemId: "qi-1", name: "Üvegtisztítás", quantity: "3", unit: "m2" },
  { quoteItemId: "qi-2", name: "Karbantartás", quantity: "1", unit: "alkalom" },
];
const tig = (lines: { quoteItemId: string; quantity: string }[]) => ({
  id: `c-${lines.length}`,
  number: "TI-2026-008",
  issuedAt: "2026-11-04T10:00:00Z",
  issuedByName: "Kovács Anna",
  documents: [],
  items: lines.map((l, i) => ({
    id: `l-${i}`,
    description: "x",
    quantity: l.quantity,
    quantityUnit: "m2",
    quoteItemId: l.quoteItemId,
  })),
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.issueForPartnerOrder.mockResolvedValue({});
});

describe("remainingQuantities", () => {
  it("a TIG-sorokból számol, tizedesvesszővel, lebegőpontos hiba nélkül", () => {
    const left = remainingQuantities(items, [
      tig([{ quoteItemId: "qi-1", quantity: "0.1" }]),
      tig([{ quoteItemId: "qi-1", quantity: "0.2" }]),
    ]);
    expect(left.get("qi-1")).toBe("2,7");
    expect(left.get("qi-2")).toBe("1");
  });
});

describe("PartnerOrderCertificatesPanel", () => {
  it("a hátralévőről indul, a szerkesztett mennyiséget küldi, a nullát kihagyja", async () => {
    api.listForPartnerOrder.mockResolvedValue([
      tig([{ quoteItemId: "qi-1", quantity: "1" }]),
    ]);
    render(
      <PartnerOrderCertificatesPanel partnerOrderId="po-1" items={items} />,
    );
    const elso = await screen.findByLabelText(
      "Üvegtisztítás: most igazolt mennyiség",
    );
    expect(elso).toHaveValue("2");
    fireEvent.change(elso, { target: { value: "1,5" } });
    fireEvent.change(
      screen.getByLabelText("Karbantartás: most igazolt mennyiség"),
      {
        target: { value: "0" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Teljesítési igazolás kiállítása" }),
    );
    await waitFor(() =>
      expect(api.issueForPartnerOrder).toHaveBeenCalledWith("token-1", "po-1", [
        { quoteItemId: "qi-1", quantity: "1,5" },
      ]),
    );
  });

  it("ha minden tétel igazolva, nincs gomb, a TIG-ek látszanak", async () => {
    api.listForPartnerOrder.mockResolvedValue([
      tig([
        { quoteItemId: "qi-1", quantity: "3" },
        { quoteItemId: "qi-2", quantity: "1" },
      ]),
    ]);
    render(
      <PartnerOrderCertificatesPanel partnerOrderId="po-1" items={items} />,
    );
    expect(await screen.findByTestId("tig-minden-kesz")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Teljesítési igazolás kiállítása" }),
    ).toBeNull();
    expect(screen.getAllByTestId("tig-sor")).toHaveLength(1);
  });

  it("a szerver hibáját a panelen mutatja", async () => {
    api.listForPartnerOrder.mockResolvedValue([]);
    api.issueForPartnerOrder.mockRejectedValue(
      new Error("A(z) „Üvegtisztítás” tételből 3 van hátra, 4 nem igazolható."),
    );
    render(
      <PartnerOrderCertificatesPanel partnerOrderId="po-1" items={items} />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Teljesítési igazolás kiállítása",
      }),
    );
    expect(await screen.findByText(/3 van hátra/)).toBeInTheDocument();
  });
});
