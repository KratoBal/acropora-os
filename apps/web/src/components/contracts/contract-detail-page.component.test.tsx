import { render, screen } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContractDetailPage } from "./contract-detail-page";
import type { ContractSummary } from "@/lib/api/contracts";

const api = vi.hoisted(() => ({ detail: vi.fn() }));
const orderApi = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/contracts", () => ({ contractsApi: api }));
vi.mock("@/lib/api/maintenance-orders", () => ({
  maintenanceOrdersApi: orderApi,
}));

function session(token: string | undefined): Session {
  return {
    id: "session-1",
    token,
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "balazs@acropora.local",
      displayName: "Balázs",
      role: "OWNER",
      customerId: null,
      supplierId: null,
    },
  };
}

function contract(): ContractSummary {
  return {
    id: "contract-1",
    customerId: "customer-1",
    customer: { id: "customer-1", displayName: "Fővárosi Állatkert" },
    number: "SZ2026/0000019",
    title: "Éves karbantartás",
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: null,
    status: "ACTIVE",
    notes: null,
    organizationalUnitName: null,
    contactPersonName: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    documents: [],
    items: [],
  };
}

/**
 * BALÁZS ÉLES HIBÁJA, 2026-09-24 17:39: az adatlap örökre "Szerződés
 * betöltése…" állapotban maradt, mert az effektus `if (token)` mögé volt
 * zárva, és éles (jelszavas, süti-alapú) bejelentkezésnél a
 * `Session.token` MINDIG `undefined` -- a kliens oldalon nincs olvasható
 * token, a böngésző httpOnly sütije hitelesít. Ez a teszt PONTOSAN ezt a
 * kalibrációt méri: üres tokennel renderelve is le kell futnia a
 * betöltésnek.
 */
describe("ContractDetailPage -- betöltés token nélkül (éles, süti-alapú bejelentkezés)", () => {
  beforeEach(() => {
    api.detail.mockReset();
    orderApi.list.mockReset().mockResolvedValue([]);
  });

  it("üres (undefined) tokennel is elindítja a betöltést, nem marad örökre 'betöltés…' állapotban", async () => {
    auth.session = session(undefined);
    api.detail.mockResolvedValue(contract());

    render(<ContractDetailPage contractId="contract-1" />);

    await screen.findByText("SZ2026/0000019");
    expect(api.detail).toHaveBeenCalledWith("", "contract-1");
    expect(orderApi.list).toHaveBeenCalledWith("", "contract-1");
  });

  /*
    POZITÍV KONTROLL: a fejlesztői (Bearer-tokenes) bejelentkezésnél is
    ugyanígy fusson le -- e nélkül egy jövőbeli "csak akkor töltsön be, ha
    VAN token" visszaállítás is zölden menne át a fenti egyetlen eseten.
  */
  it("valódi tokennel is lefut a betöltés", async () => {
    auth.session = session("dev-token");
    api.detail.mockResolvedValue(contract());

    render(<ContractDetailPage contractId="contract-1" />);

    await screen.findByText("SZ2026/0000019");
    expect(api.detail).toHaveBeenCalledWith("dev-token", "contract-1");
  });
});
