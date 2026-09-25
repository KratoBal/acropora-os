import { render, screen } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompletionCertificatePanel } from "./completion-certificate-panel";

const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/completion-certificates", () => ({
  completionCertificatesApi: api,
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

/**
 * UGYANAZ A HIBAOSZTÁLY, MINT A `pilot-contract-detail-page.tsx`-en (Balázs
 * éles hibája, 2026-09-24 17:39, ugyanabban a percben mérve ezen a
 * fájlon is): `if (token)` a `useEffect`-ben SOHA nem futna éles, süti-
 * alapú bejelentkezésnél, mert a `Session.token` ott mindig `undefined`.
 * A panel örökre "Betöltés…" állapotban maradna.
 */
describe("CompletionCertificatePanel -- betöltés token nélkül", () => {
  beforeEach(() => {
    api.list.mockReset().mockResolvedValue([]);
  });

  it("üres (undefined) tokennel is elindítja a betöltést", async () => {
    auth.session = session(undefined);

    render(<CompletionCertificatePanel serviceJobId="job-1" />);

    // A "Betöltés…" szöveg eltűnik, és a kiállítás gomb megjelenik --
    // ez csak akkor történhet, ha a `load()` ténylegesen lefutott.
    await screen.findByRole("button", {
      name: "Teljesítési igazolás kiállítása",
    });
    expect(api.list).toHaveBeenCalledWith("", "job-1");
  });

  it("valódi tokennel is lefut a betöltés", async () => {
    auth.session = session("dev-token");

    render(<CompletionCertificatePanel serviceJobId="job-1" />);

    await screen.findByRole("button", {
      name: "Teljesítési igazolás kiállítása",
    });
    expect(api.list).toHaveBeenCalledWith("dev-token", "job-1");
  });
});
