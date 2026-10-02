import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { stockReconciliationWidget } from "./stock-reconciliation-widget";
import { stockSyncOutboxWidget } from "./stock-sync-outbox-widget";

describe("a készlet-widgetek", () => {
  it("a kimenősor csak állapotot mutat: nincs rajta gomb, és a sikeres sorokat nem számolja", () => {
    const { Body } = stockSyncOutboxWidget;
    render(
      <Body
        data={{
          queued: 4,
          retrying: 2,
          deadLetter: 1,
          lastSuccessfulSyncAt: null,
        }}
      />,
    );
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Kézi beavatkozás (DEAD_LETTER)")).toBeTruthy();
    expect(screen.getByText("nincs adat")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("az egyeztetés üres állapota csak teendő nélkül áll", () => {
    expect(
      stockReconciliationWidget.emptyMessage({ count: 0, items: [] }),
    ).toBe("Nincs teendőt igénylő készleteltérés.");
    const { Body } = stockReconciliationWidget;
    render(
      <Body
        data={{
          count: 2,
          items: [
            {
              variantId: "v1",
              sku: "KIT-SKU-1",
              warehouseCode: "KIT",
              status: "SYNC_FAILED",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("KIT-SKU-1")).toBeTruthy();
  });
});
