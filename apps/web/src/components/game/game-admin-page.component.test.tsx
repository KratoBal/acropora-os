import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  questions: vi.fn(),
  createQuestion: vi.fn(),
  entries: vi.fn(),
  decide: vi.fn(),
  draws: vi.fn(),
  draw: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/lib/api/game", () => ({ gameApi: api }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tartalom/nyeremenyjatek",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

import { GameAdminPage } from "./game-admin-page";

/*
  A NYEREMÉNYJÁTÉK KEZELÉSE (kártya 31445d0f). MI PIROSÍT: ha a beküldésnél nem látszik, megerősítette-e és helyes-e;
  ha a kétes válasz kézi elfogadása nem a beküldés döntését küldi; ha a sorsolás megerősítés nélkül indul, vagy nem a
  választott hétre; ha a mentett sorsolás újrafuttatása nem mondja ki, hogy ugyanaz jött-e ki; ha olvasási joggal is
  van döntő vagy sorsoló gomb.
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

beforeEach(() => {
  auth.session = as("OWNER");
  api.questions.mockReset().mockResolvedValue([
    {
      id: "q1",
      week: "2026-W45",
      type: "TEXT",
      prompt: "Melyik a legismertebb zátonyépítő korall?",
      options: [],
      acceptedAnswers: ["Acropora"],
      opensAt: "2026-11-06T05:00:00.000Z",
      closesAt: "2026-11-13T22:59:59.000Z",
      entryCount: 2,
      confirmedCount: 1,
      candidateCount: 1,
    },
  ]);
  api.entries.mockReset().mockResolvedValue([
    {
      id: "e1",
      email: "jo@x.hu",
      answer: "acropora",
      autoCorrect: true,
      manualCorrect: null,
      manualAt: null,
      confirmedAt: "2026-11-06T10:00:00.000Z",
      createdAt: "2026-11-06T09:00:00.000Z",
      counts: true,
    },
    {
      id: "e2",
      email: "ketes@x.hu",
      answer: "akropóra korall",
      autoCorrect: false,
      manualCorrect: null,
      manualAt: null,
      confirmedAt: "2026-11-06T10:00:00.000Z",
      createdAt: "2026-11-06T09:30:00.000Z",
      counts: false,
    },
  ]);
  api.decide.mockReset().mockResolvedValue({});
  api.draws.mockReset().mockResolvedValue([
    {
      id: "d1",
      kind: "WEEKLY",
      questionId: "q1",
      question: { week: "2026-W45" },
      seed: "abc123",
      candidates: [{ email: "jo@x.hu", weight: 1 }],
      winnerEmail: "jo@x.hu",
      ticket: 0,
      tickets: 1,
      createdAt: "2026-11-07T18:00:00.000Z",
    },
  ]);
  api.draw.mockReset().mockResolvedValue({});
  api.verify.mockReset().mockResolvedValue({
    drawId: "d1",
    seed: "abc123",
    winnerEmail: "jo@x.hu",
    same: true,
  });
});

describe("GameAdminPage", () => {
  it("lists the entries with their state, and a doubtful answer is accepted by hand", async () => {
    render(<GameAdminPage />);
    const entries = await screen.findByTestId("game-entries");
    expect(entries).toHaveTextContent("jo@x.hu");
    expect(entries).toHaveTextContent("nem egyezik");
    fireEvent.click(within(entries).getByRole("button", { name: "Elfogadom" }));
    await waitFor(() =>
      expect(api.decide).toHaveBeenCalledWith("t", "e2", true),
    );
  });

  it("draws for the chosen week only after the confirmation, and runs a kept draw again with its seed", async () => {
    render(<GameAdminPage />);
    const draws = await screen.findByTestId("game-draws");
    expect(
      within(draws).getByRole("button", { name: "Heti sorsolás" }),
    ).toBeDisabled();
    fireEvent.change(within(draws).getByRole("combobox"), {
      target: { value: "q1" },
    });
    fireEvent.click(
      within(draws).getByRole("button", { name: "Heti sorsolás" }),
    );
    expect(api.draw).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Sorsolás" }));
    await waitFor(() =>
      expect(api.draw).toHaveBeenCalledWith("t", "WEEKLY", "q1"),
    );
    fireEvent.click(
      within(draws).getByRole("button", {
        name: "Újrafuttatás ugyanazzal a maggal",
      }),
    );
    expect(
      await within(draws).findByText(/újrafuttatva: ugyanaz: jo@x.hu/),
    ).toBeInTheDocument();
  });

  it("with the reading right only there is no decision and no draw", async () => {
    auth.session = as("VIEWER");
    api.questions.mockResolvedValue([]);
    render(<GameAdminPage />);
    await waitFor(() => expect(api.questions).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Heti sorsolás" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kérdés mentése" })).toBeNull();
  });
});
