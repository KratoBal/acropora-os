import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseInvoiceScans } from "./purchase-invoice-scans";

const api = vi.hoisted(() => ({ attachScan: vi.fn(), scanPdf: vi.fn() }));
vi.mock("@/lib/api/purchasing", () => ({ purchasingApi: api }));

const SCAN = {
  id: "d1",
  fileName: "szlovak-szamla.pdf",
  sizeBytes: 1234,
  createdAt: "2026-10-08T07:30:00Z",
};

describe("Számlakép (5ec62e35)", () => {
  beforeEach(() => {
    api.attachScan.mockReset();
    api.scanPdf.mockReset();
  });

  it("a kiválasztott képet csatolja, és a visszakapott listát mutatja", async () => {
    api.attachScan.mockResolvedValue([SCAN]);
    const onChange = vi.fn();
    render(
      <PurchaseInvoiceScans
        token="t"
        invoiceId="pi-1"
        scans={[]}
        canManage
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Nincs csatolt számlakép.")).toBeTruthy();
    const file = new File([new Uint8Array([0x89, 0x50])], "lap.png", {
      type: "image/png",
    });
    fireEvent.change(screen.getByLabelText("Számlakép csatolása"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(api.attachScan).toHaveBeenCalledWith("t", "pi-1", file),
    );
    expect(onChange).toHaveBeenCalledWith([SCAN]);
  });

  it("jog nélkül csak a lista látszik, feltöltés nincs", () => {
    render(
      <PurchaseInvoiceScans
        token="t"
        invoiceId="pi-1"
        scans={[SCAN]}
        canManage={false}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "szlovak-szamla.pdf megnyitása" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Számlakép csatolása")).toBeNull();
  });

  it("a szerver elutasítását kiírja", async () => {
    api.attachScan.mockRejectedValue(
      new Error("Csak PDF, JPEG vagy PNG fájl csatolható számlaképként."),
    );
    render(
      <PurchaseInvoiceScans
        token="t"
        invoiceId="pi-1"
        scans={[]}
        canManage
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Számlakép csatolása"), {
      target: { files: [new File(["x"], "level.txt", { type: "text/plain" })] },
    });
    expect(
      await screen.findByText(
        "Csak PDF, JPEG vagy PNG fájl csatolható számlaképként.",
      ),
    ).toBeTruthy();
  });
});
