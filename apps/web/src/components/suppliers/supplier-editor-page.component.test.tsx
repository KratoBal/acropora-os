import { render, screen } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierEditorPage } from "./supplier-editor-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const suppliers = vi.hoisted(() => ({
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
const postalCode = vi.hoisted(() => ({ lookup: vi.fn() }));
const viesVat = vi.hoisted(() => ({ lookup: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: suppliers }));
vi.mock("@/lib/api/postal-code", () => ({ postalCodeApi: postalCode }));
vi.mock("@/lib/api/vies-vat", () => ({ viesVatApi: viesVat }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
  },
};

describe("SupplierEditorPage", () => {
  beforeEach(() => {
    auth.session = session;
    suppliers.detail.mockReset();
    suppliers.create.mockReset();
  });

  /** The Partners menu no longer holds suppliers only, so the screen must not
   * call every new record a supplier. The list page carries the same label and
   * is asserted in its own spec: changing one of the two and leaving the other
   * is exactly the half-finished state this pair of assertions rules out. */
  it("names a new record without calling it a supplier", () => {
    render(<SupplierEditorPage />);

    expect(screen.getByText("Új felvitele")).toBeTruthy();
    expect(screen.queryByText("Új beszállító")).toBeNull();
  });
});
