import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserEditorPage } from "./user-editor-page";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/admin/users", fromWithinApp: false }),
}));
vi.mock("@/lib/api/users", () => ({
  usersApi: { create: vi.fn(), detail: vi.fn(), update: vi.fn() },
}));
vi.mock("@acropora/types", () => ({
  PERMISSIONS: { USERS_MANAGE: "users.manage" },
  hasPermission: () => true,
  isNavigationEntryVisible: () => false,
}));
vi.mock("@/components/service-jobs/partner-picker", () => ({
  PartnerPicker: ({
    onPick,
  }: {
    onPick: (partner: { customerId: string }) => void;
  }) => (
    <button type="button" onClick={() => onPick({ customerId: "customer-1" })}>
      Vevő kiválasztása
    </button>
  ),
}));
vi.mock("./role-labels", () => ({
  ROLE_LABELS: {
    VIEWER: "Megtekintő",
    PARTNER_SERVICE: "Partner szerviz",
  },
  ROLE_OPTIONS: [
    { value: "VIEWER", label: "Megtekintő" },
    { value: "PARTNER_SERVICE", label: "Partner szerviz" },
  ],
}));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner-1",
    email: "owner@acropora.local",
    displayName: "Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

describe("UserEditorPage partner szerepköre", () => {
  beforeEach(() => {
    auth.session = session;
    router.push.mockReset();
  });

  it("vevő kiválasztásakor csak a Partner szerviz szerepet kínálja és megmagyarázza", async () => {
    render(<UserEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "Vevő kiválasztása" }));

    const role = screen.getByLabelText("Szerepkör") as HTMLSelectElement;
    await waitFor(() => expect(role.value).toBe("PARTNER_SERVICE"));
    expect(within(role).getAllByRole("option")).toHaveLength(1);
    expect(within(role).getByRole("option")).toHaveTextContent(
      "Partner szerviz",
    );
    expect(
      screen.getByText(/szándékosan csak Partner szerviz lehet/i),
    ).toBeInTheDocument();
  });
});
