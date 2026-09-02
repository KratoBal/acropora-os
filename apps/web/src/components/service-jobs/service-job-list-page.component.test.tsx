import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ServiceJobListResponse, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceJobListPage } from "./service-job-list-page";

const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-sanyi",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

function response(
  overrides: Partial<ServiceJobListResponse> = {},
): ServiceJobListResponse {
  return {
    items: [
      {
        id: "job-1",
        jobNumber: "HJ-2026-001",
        title: "Cápasuli szivattyú leállt",
        // A BELSŐ és a LÁTSZÓ állapot szándékosan NEM ugyanaz ebben a
        // mintában: pont az a kérdés, hogy a lista mind a kettőt kiírja-e.
        status: "WAITING_FOR_PARTS",
        partnerStatus: "IN_PROGRESS",
        partnerStatusLabel: "Feldolgozás alatt",
        customerName: "Fővárosi Állat- És Növénykert",
        worksheetCount: 2,
        createdAt: "2026-09-01T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("ServiceJobListPage", () => {
  beforeEach(() => {
    auth.session = session;
    api.list.mockReset().mockResolvedValue(response());
  });

  /**
   * A KEZELŐNEK TUDNIA KELL, MIT OLVAS A MÁSIK FÉL. Ha csak a belső állapot
   * látszana, egy alkatrészre váró jegyről azt hinné, hogy a partner is ezt
   * látja - holott a partner „Feldolgozás alatt" szöveget kap.
   */
  it("a belső állapot mellett kiírja azt is, amit a partner lát", async () => {
    render(<ServiceJobListPage />);

    expect(await screen.findByText("Alkatrészre vár")).toBeTruthy();
    expect(
      screen.getByText("A partner ezt látja: Feldolgozás alatt"),
    ).toBeTruthy();
  });

  it("a lezártakat külön kell kérni, és akkor a szervertől kéri", async () => {
    render(<ServiceJobListPage />);
    await screen.findByText("Alkatrészre vár");
    expect(api.list.mock.calls.at(-1)?.[1]).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "A lezártak is" }));

    await waitFor(() => expect(api.list.mock.calls.at(-1)?.[1]).toBe("all"));
  });

  it("üres listán megmondja, hogy a lezártak külön kérhetők", async () => {
    api.list.mockResolvedValue(response({ items: [] }));
    render(<ServiceJobListPage />);

    expect(
      await screen.findByText(
        "Nyitott hibajegy jelenleg nincs. A lezártakat a fenti gombbal nézheted meg.",
      ),
    ).toBeTruthy();
  });
});
