import { act, render, screen } from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  liveDraw: vi.fn(),
  runLiveDraw: vi.fn(),
  questions: vi.fn(),
  prizeImageContent: vi.fn(),
}));
vi.mock("@/lib/api/game", () => ({ gameApi: api }));
const search = vi.hoisted(() => ({ value: "kind=WEEKLY&kerdes=q1" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

import { LiveDrawPage, REVEAL_MS } from "./live-draw-page";

/*
  AZ ÉLŐ SORSOLÁS OLDALA (acrobot 44363). MI PIROSÍT: ha a nyertes neve a 10 másodperc előtt a képernyőre kerül; ha a
  gomb kétszer is sorsolhat (az első sorsolás végleges); ha már megtörtént sorsolásnál gomb van; ha az animáció alatt
  bármilyen játékos neve vagy címe megjelenik; ha a megállt szám nem a szerver szelvényszáma; ha jogosultság nélkül
  gomb vagy hívás van.
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

const before = {
  kind: "WEEKLY",
  questionId: "q1",
  week: "2026-W45",
  prizeName: "Aquaforest AF Nano Tank",
  prizeImageId: null,
  candidates: 142,
  tickets: 142,
  blocked: null,
  drawn: null,
};
const drawn = {
  drawId: "d1",
  winnerName: "Kovács P.",
  winnerEmailMasked: "ko•••@gmail.com",
  ticket: 86,
  tickets: 142,
  drawnAt: "2026-11-14T20:00:00.000Z",
};

async function mount() {
  render(<LiveDrawPage />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  auth.session = as("OWNER");
  search.value = "kind=WEEKLY&kerdes=q1";
  api.liveDraw.mockReset().mockResolvedValue(before);
  api.runLiveDraw.mockReset().mockResolvedValue({ ...before, drawn });
  api.questions.mockReset().mockResolvedValue([]);
  api.prizeImageContent.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("the live draw page", () => {
  it("before the draw it shows the title, the prize, the chances in the hat and the one button", async () => {
    await mount();
    expect(screen.getByText("45. heti sorsolás")).toBeTruthy();
    expect(screen.getByText("Aquaforest AF Nano Tank")).toBeTruthy();
    expect(screen.getByTestId("live-draw-count").textContent).toContain(
      "142 esély a kalapban",
    );
    expect(screen.getByRole("button", { name: "Sorsolás" })).toBeTruthy();
    expect(api.liveDraw).toHaveBeenCalledWith("t", "WEEKLY", "q1");
    expect(api.runLiveDraw).not.toHaveBeenCalled();
  });

  it("the winner is not on the screen before the ten seconds are up, the stopped number is the server's ticket, then the name and the masked address come", async () => {
    await mount();
    await act(async () => {
      screen.getByRole("button", { name: "Sorsolás" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.runLiveDraw).toHaveBeenCalledTimes(1);
    expect(api.runLiveDraw).toHaveBeenCalledWith("t", "WEEKLY", "q1");
    // the server answered at once, yet nothing about the winner shows
    expect(screen.queryByText("Kovács P.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sorsolás" })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVEAL_MS.settle - 1);
    });
    expect(screen.queryByText("Kovács P.")).toBeNull();
    expect(screen.queryByText("ko•••@gmail.com", { exact: false })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    // 0-based ticket 86 is the 87th ticket
    expect(screen.getByTestId("live-draw-ticket").textContent).toContain("87");
    expect(screen.queryByText("Kovács P.")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVEAL_MS.name - REVEAL_MS.settle);
    });
    expect(screen.getByTestId("live-draw-winner").textContent).toBe(
      "Kovács P.",
    );
    expect(screen.getByText("(ko•••@gmail.com)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sorsolás" })).toBeNull();
  });

  it("two presses in the same moment draw once", async () => {
    await mount();
    await act(async () => {
      const button = screen.getByRole("button", { name: "Sorsolás" });
      button.click();
      button.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.runLiveDraw).toHaveBeenCalledTimes(1);
  });

  it("a week that was already drawn shows its result and has no button", async () => {
    api.liveDraw.mockResolvedValue({ ...before, drawn });
    await mount();
    expect(screen.getByTestId("live-draw-winner").textContent).toBe(
      "Kovács P.",
    );
    expect(screen.getByText("Ez a sorsolás már megtörtént.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sorsolás" })).toBeNull();
    expect(api.runLiveDraw).not.toHaveBeenCalled();
  });

  it("a draw that cannot start yet says why and has no button", async () => {
    api.liveDraw.mockResolvedValue({
      ...before,
      blocked: "A heti sorsolás a kérdés zárása után indítható.",
    });
    await mount();
    expect(screen.getByText(/zárása után indítható/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sorsolás" })).toBeNull();
  });

  it("a failed draw shows the error and gives the button back", async () => {
    api.runLiveDraw.mockRejectedValue(new Error("Nem sikerült."));
    await mount();
    await act(async () => {
      screen.getByRole("button", { name: "Sorsolás" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("alert").textContent).toBe("Nem sikerült.");
    expect(screen.getByRole("button", { name: "Sorsolás" })).toBeTruthy();
  });

  it("a week with no valid entry says there is no winner instead of an empty name", async () => {
    api.runLiveDraw.mockResolvedValue({
      ...before,
      candidates: 0,
      tickets: 0,
      drawn: {
        ...drawn,
        winnerName: null,
        winnerEmailMasked: null,
        ticket: null,
        tickets: 0,
      },
    });
    await mount();
    await act(async () => {
      screen.getByRole("button", { name: "Sorsolás" }).click();
      await vi.advanceTimersByTimeAsync(REVEAL_MS.name);
    });
    expect(screen.getByTestId("live-draw-winner").textContent).toContain(
      "Nincs nyertes",
    );
  });

  it("without the manage permission there is no button and no call", async () => {
    auth.session = as("VIEWER");
    await mount();
    expect(screen.getByRole("alert").textContent).toContain(
      "nincs jogosultság",
    );
    expect(screen.queryByRole("button", { name: "Sorsolás" })).toBeNull();
    expect(api.liveDraw).not.toHaveBeenCalled();
  });

  it("without a target it offers the weeks and the Christmas draw, and no player appears", async () => {
    search.value = "";
    api.questions.mockResolvedValue([
      {
        id: "q1",
        week: "2026-W45",
        prizeName: "Aquaforest AF Nano Tank",
      },
    ]);
    await mount();
    const week = screen.getByText("45. heti sorsolás").closest("a");
    expect(week?.getAttribute("href")).toBe("/sorsolas?kind=WEEKLY&kerdes=q1");
    expect(
      screen
        .getByText("Karácsonyi fődíj sorsolás")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/sorsolas?kind=CHRISTMAS");
    expect(api.liveDraw).not.toHaveBeenCalled();
  });
});
