import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/api/shipping-fill", () => ({ shippingFillApi: api }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

import { ShippingFillPage } from "./shipping-fill-page";

/*
  A SZÁLLÍTÁSI JELZŐK FELTÖLTÉSE A BEÁLLÍTÁSOKBAN (a82ed229; acrobot 43016). MI PIROSÍT: ha a feltöltés próba nélkül
  indítható; ha nem a próba lenyomatát küldi; ha a próba nem mutatja a cél-adatbázist és a számokat; ha egy elutasítás
  után a régi próba lenyomatával újra lehet írni; ha jog nélkül a gombok látszanak.
*/
function as(role: UserRole): Session {
  return {
    id: "s",
    token: "t",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u",
      email: "u@acropora.local",
      displayName: "U",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

const preview = {
  target: "db.stage:5432/acropora",
  report: {
    products: 1900,
    create: 1850,
    update: 12,
    unchanged: 38,
    updatedFlags: {
      pickupOnly: 4,
      foxpostForbidden: 6,
      isHeavy: 2,
      isFrozen: 0,
    },
    manualDiffers: [],
    manualDiffersTotal: 1,
  },
  fingerprint: "a".repeat(64),
};

beforeEach(() => {
  auth.session = as("OWNER");
  api.preview.mockReset().mockResolvedValue(preview);
  api.apply.mockReset();
});

describe("ShippingFillPage", () => {
  it("writes only after a preview, with its fingerprint, and shows the target and the numbers", async () => {
    api.apply.mockResolvedValue({
      target: preview.target,
      created: 1850,
      updated: 12,
    });
    render(<ShippingFillPage />);
    expect(screen.getByRole("button", { name: "Feltöltés" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Próba" }));
    const shown = await screen.findByTestId("shipping-fill-preview");
    expect(shown).toHaveTextContent("db.stage:5432/acropora");
    expect(shown).toHaveTextContent("1850");
    fireEvent.click(screen.getByRole("button", { name: "Feltöltés" }));
    fireEvent.click(await screen.findByRole("button", { name: "Feltöltöm" }));
    await waitFor(() =>
      expect(api.apply).toHaveBeenCalledWith("t", "a".repeat(64)),
    );
    expect(
      await screen.findByText(/1850 új sor, 12 frissített/),
    ).toBeInTheDocument();
  });

  it("a refused write drops the old preview: no second write with its fingerprint", async () => {
    api.apply.mockRejectedValue(new Error("A terv közben változott"));
    render(<ShippingFillPage />);
    fireEvent.click(screen.getByRole("button", { name: "Próba" }));
    await screen.findByTestId("shipping-fill-preview");
    fireEvent.click(screen.getByRole("button", { name: "Feltöltés" }));
    fireEvent.click(await screen.findByRole("button", { name: "Feltöltöm" }));
    expect(
      await screen.findByText("A terv közben változott"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feltöltés" })).toBeDisabled();
  });

  it("without settings.manage there is no button", () => {
    auth.session = as("VIEWER");
    render(<ShippingFillPage />);
    expect(screen.queryByRole("button", { name: "Próba" })).toBeNull();
  });
});
