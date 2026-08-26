import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiTestPage } from "./ai-test-page";
import type { AiChatReply } from "@/lib/api/ai-chat";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const api = vi.hoisted(() => ({
  ask: vi.fn(),
  rate: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/ai-chat", () => ({ aiChatApi: api }));

const session = (): Session => ({
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-balazs",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
  },
});

const reply = (overrides: Partial<AiChatReply> = {}): AiChatReply => ({
  conversationId: "6f1d0a2c-1b7e-4a3f-9c2d-8b5e4f7a1c30",
  messageId: "b2c4d6e8-0a1b-4c3d-8e5f-9a7b6c5d4e3f",
  answer: "Egy válasz.",
  model: "gpt-5.1",
  customerContextStatus: "anonymous",
  productContext: "Nincs termékkontextus.",
  elapsedMs: 8_512,
  errorCode: null,
  providerWaitedMs: null,
  httpStatus: 200,
  ...overrides,
});

const ask = async (answer: AiChatReply = reply()) => {
  api.ask.mockResolvedValueOnce(answer);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Van-e Fauna Marin nyomelem-adalékunk?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Kérdés elküldése" }));
  // A kérdés minden esetben megjelenik a kártyán, hibás válasznál is.
  await screen.findByText("Van-e Fauna Marin nyomelem-adalékunk?");
};

/**
 * Az értékelés a mérés adata, tehát a szerverre kell kerülnie.
 *
 * Amíg csak a komponens állapotában élt, egy oldalfrissítés elvitte. Ezek a
 * tesztek azt rögzítik, hogy a gomb HÍV, és hogy a felület nem állítja
 * elmentettnek azt, amit a szerver nem vett át.
 */
describe("AiTestPage értékelés", () => {
  beforeEach(() => {
    auth.session = session();
    api.ask.mockReset();
    api.rate.mockReset().mockResolvedValue({
      rating: "inaccurate",
      ratedAt: "2026-08-26T20:00:00.000Z",
      errorCode: null,
    });
  });

  it("elküldi az értékelést a szervernek, a válasz azonosítójával", async () => {
    render(<AiTestPage />);
    await ask();

    fireEvent.click(screen.getByRole("button", { name: "Pontatlan" }));

    await waitFor(() => {
      expect(api.rate).toHaveBeenCalledWith(
        "token-1",
        "b2c4d6e8-0a1b-4c3d-8e5f-9a7b6c5d4e3f",
        "inaccurate",
      );
    });
    expect(await screen.findByText("Elmentve: Pontatlan")).toBeTruthy();
  });

  it("nem mondja elmentettnek, amit a szerver elutasított", async () => {
    // A néma kudarc a rosszabbik eset: a gomb kiválasztottnak látszana, és a
    // mérésből csendben hiányozna egy sor.
    api.rate.mockResolvedValueOnce({
      rating: null,
      ratedAt: null,
      errorCode: "answer not found",
    });

    render(<AiTestPage />);
    await ask();

    fireEvent.click(screen.getByRole("button", { name: "Helyes" }));

    expect(
      await screen.findByText("Az értékelés nem mentődött el"),
    ).toBeTruthy();
    expect(screen.queryByText("Elmentve: Helyes")).toBeNull();
  });

  it("a hálózati hibát is megmutatja, nem nyeli el", async () => {
    api.rate.mockRejectedValueOnce(new Error("Nincs kapcsolat."));

    render(<AiTestPage />);
    await ask();

    fireEvent.click(screen.getByRole("button", { name: "Veszélyes" }));

    expect(await screen.findByText("Nincs kapcsolat.")).toBeTruthy();
    expect(screen.queryByText("Elmentve: Veszélyes")).toBeNull();
  });

  it("nem enged értékelni olyan választ, aminek nincs azonosítója", async () => {
    // Hibás híváskor nincs eltárolt válasz, tehát nincs mire hivatkozni.
    render(<AiTestPage />);
    await ask(
      reply({
        messageId: null,
        answer: null,
        errorCode: "ai_provider_timeout",
        httpStatus: 504,
      }),
    );

    /*
      A hibakód maga is a mérés adata, tehát látszania kell. Sokáig nem
      látszott: az Alert a törzsét csendben eldobta, és csak a címe jelent meg.
    */
    const shown = await screen.findAllByText("ai_provider_timeout");
    expect(shown.length).toBeGreaterThan(0);

    for (const label of ["Helyes", "Pontatlan", "Veszélyes", "Nincs adat"]) {
      expect(
        (screen.getByRole("button", { name: label }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }
    expect(api.rate).not.toHaveBeenCalled();
  });
});
