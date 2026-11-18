import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompletionCertificatePanel } from "./completion-certificate-panel";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  issue: vi.fn(),
  uploadSignedDocument: vi.fn(),
}));
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

describe("CompletionCertificatePanel -- forrás nélküli lap", () => {
  beforeEach(() => {
    api.list.mockReset().mockResolvedValue([]);
    auth.session = session("dev-token");
  });

  /*
    MI PIROSÍT: ha az ok megadásakor a gomb aktív marad; ha az ok nem látszik a gomb mellett; ha ok nélkül a gomb tiltott lenne (a megrendelőlapos és a tételes szerződéses lap).
  */
  it("ok megadásakor a gomb tiltott, és az ok látszik mellette", async () => {
    render(
      <CompletionCertificatePanel
        serviceJobId="job-1"
        blockedReason="A teljesítési igazolás nem állítható ki: a lapnak nincs megrendelőlapja és szerződéstétele."
      />,
    );
    const button = await screen.findByRole("button", {
      name: "Teljesítési igazolás kiállítása",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/nincs megrendelőlapja/)).toBeTruthy();
  });

  it("ok nélkül a gomb aktív", async () => {
    render(<CompletionCertificatePanel serviceJobId="job-1" />);
    const button = await screen.findByRole("button", {
      name: "Teljesítési igazolás kiállítása",
    });
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});

/*
  A SZÁMLA-KÁRTYA FRISSÜL (stage-végigjárás, 2026-11-18): az aláírt PDF feltöltése után a mellette álló számla-kártya a régi állapotot mutatta az oldal újratöltéséig, mert a két panel külön
  töltötte be az igazolást. MI PIROSÍT: ha a feltöltés vagy a kiállítás után a panel nem szól a hívónak (`onChanged`), és így a testvér-panel nem tud újratölteni.
*/
describe("CompletionCertificatePanel -- változás jelzése", () => {
  const certificate = {
    id: "cert-1",
    number: "TI-2026-001",
    issuedAt: "2026-11-18T00:00:00.000Z",
    issuedByName: null,
    documents: [],
  };
  beforeEach(() => {
    auth.session = session("dev-token");
    api.issue.mockReset().mockResolvedValue(undefined);
    api.uploadSignedDocument.mockReset().mockResolvedValue(undefined);
  });

  it("az aláírt PDF feltöltése után jelzi a változást", async () => {
    api.list.mockReset().mockResolvedValue([certificate]);
    const onChanged = vi.fn();
    const { container } = render(
      <CompletionCertificatePanel serviceJobId="job-1" onChanged={onChanged} />,
    );
    await screen.findByText("Aláírt PDF feltöltése");
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(["x"], "alairt.pdf", { type: "application/pdf" })],
      },
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(api.uploadSignedDocument).toHaveBeenCalledTimes(1);
  });

  it("a kiállítás után jelzi a változást, hiba esetén nem", async () => {
    api.list.mockReset().mockResolvedValue([]);
    const onChanged = vi.fn();
    render(
      <CompletionCertificatePanel serviceJobId="job-1" onChanged={onChanged} />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Teljesítési igazolás kiállítása",
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    api.issue.mockRejectedValue(new Error("nem megy"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Teljesítési igazolás kiállítása",
      }),
    );
    await screen.findByText("nem megy");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
