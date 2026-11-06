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
  updateQuestion: vi.fn(),
  entries: vi.fn(),
  decide: vi.fn(),
  draws: vi.fn(),
  draw: vi.fn(),
  verify: vi.fn(),
  mailQueue: vi.fn(),
  sendQueued: vi.fn(),
  testLink: vi.fn(),
  uploadPrizeImage: vi.fn(),
  prizeImageContent: vi.fn(),
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
  api.createQuestion.mockReset();
  api.updateQuestion.mockReset();
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
      prizeName: "Aquaforest AF Nano Tank",
      prizeDescription: null,
      prizeImageId: null,
      entryCount: 2,
      confirmedCount: 1,
      candidateCount: 1,
    },
  ]);
  api.entries.mockReset().mockResolvedValue([
    {
      id: "e1",
      email: "jo@x.hu",
      name: "Kovács Péter",
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
      name: null,
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
  api.mailQueue.mockReset().mockResolvedValue({
    pending: 4,
    sentToday: 3000,
    dailyCap: 3000,
    blocked: "path-off",
    lastError: null,
    testLinks: true,
  });
  api.testLink.mockReset().mockResolvedValue({
    link: "https://jatek-teszt.acropora.hu/megerosites?token=abc",
  });
  api.sendQueued.mockReset().mockResolvedValue({
    pending: 0,
    sentToday: 3000,
    dailyCap: 3000,
    sent: 4,
  });
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
      names: { "jo@x.hu": "Kovács Péter" },
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

  it("shows the player's name next to the address in the entries, the draw's winner and the question's prize; a nameless entry shows the address alone", async () => {
    render(<GameAdminPage />);
    const entries = await screen.findByTestId("game-entries");
    expect(entries).toHaveTextContent("Kovács Péter · jo@x.hu");
    expect(entries).not.toHaveTextContent("null");
    const draws = await screen.findByTestId("game-draws");
    expect(draws).toHaveTextContent("Kovács Péter · jo@x.hu");
    expect(
      await screen.findByText("nyeremény: Aquaforest AF Nano Tank"),
    ).toBeInTheDocument();
  });

  it("saves a new question with the opening and closing as Budapest time (day and hour:minute) and the week's prize", async () => {
    api.createQuestion.mockResolvedValue({});
    api.uploadPrizeImage.mockResolvedValue({ id: "img1" });
    api.prizeImageContent.mockResolvedValue(
      new Blob(["x"], { type: "image/png" }),
    );
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    render(<GameAdminPage />);
    const form = await screen.findByTestId("game-new-question");
    fireEvent.change(within(form).getByLabelText("Hét"), {
      target: { value: "2026-W46" },
    });
    fireEvent.change(within(form).getByLabelText("Kérdés szövege"), {
      target: { value: "Mi a kérdés?" },
    });
    fireEvent.change(within(form).getByLabelText("Elfogadott válaszok"), {
      target: { value: "Acropora" },
    });
    fireEvent.change(within(form).getByLabelText("Nyitás napja"), {
      target: { value: "2026. 11. 07." },
    });
    fireEvent.change(within(form).getByLabelText("Nyitás ideje"), {
      target: { value: "21:00" },
    });
    fireEvent.change(within(form).getByLabelText("Zárás napja"), {
      target: { value: "2026. 11. 14." },
    });
    fireEvent.change(within(form).getByLabelText("Zárás ideje"), {
      target: { value: "20:59" },
    });
    fireEvent.change(within(form).getByLabelText("Nyeremény neve"), {
      target: { value: "  AF Nano Tank " },
    });
    fireEvent.change(within(form).getByLabelText("Nyeremény leírása"), {
      target: { value: "Egy kis akvárium." },
    });
    const file = new File(["x"], "nano.png", { type: "image/png" });
    fireEvent.change(within(form).getByLabelText("Nyeremény képe"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(api.uploadPrizeImage).toHaveBeenCalledWith("t", file),
    );
    await within(form).findByAltText("A nyeremény képe");
    fireEvent.click(
      within(form).getByRole("button", { name: "Kérdés mentése" }),
    );
    await waitFor(() => expect(api.createQuestion).toHaveBeenCalledTimes(1));
    expect(api.createQuestion.mock.calls[0]![1]).toMatchObject({
      week: "2026-W46",
      // 21:00 budapesti (CET, +1) = 20:00 UTC; 20:59 egy hét múlva
      opensAt: "2026-11-07T20:00:00.000Z",
      closesAt: "2026-11-14T19:59:00.000Z",
      prizeName: "AF Nano Tank",
      prizeDescription: "Egy kis akvárium.",
      prizeImageId: "img1",
    });
  });

  it("corrects an existing question with the same form: prefilled in Budapest time, an untouched time stays as stored (seconds too), a changed one is rebuilt, the week is locked", async () => {
    api.updateQuestion.mockResolvedValue({});
    render(<GameAdminPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Kérdés javítása (2026-W45)" }),
    );
    const form = await screen.findByTestId("game-edit-question");
    expect(within(form).getByLabelText("Hét")).toBeDisabled();
    expect(within(form).getByLabelText("Hét")).toHaveValue("2026-W45");
    expect(within(form).getByLabelText("Kérdés szövege")).toHaveValue(
      "Melyik a legismertebb zátonyépítő korall?",
    );
    expect(within(form).getByLabelText("Nyitás ideje")).toHaveValue("06:00");
    expect(within(form).getByLabelText("Zárás ideje")).toHaveValue("23:59");
    expect(within(form).getByLabelText("Nyeremény neve")).toHaveValue(
      "Aquaforest AF Nano Tank",
    );
    fireEvent.change(within(form).getByLabelText("Nyeremény leírása"), {
      target: { value: "Egy kis akvárium." },
    });
    fireEvent.change(within(form).getByLabelText("Nyitás ideje"), {
      target: { value: "21:00" },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Kérdés mentése" }),
    );
    await waitFor(() => expect(api.updateQuestion).toHaveBeenCalledTimes(1));
    const [token, id, input] = api.updateQuestion.mock.calls[0]!;
    expect([token, id]).toEqual(["t", "q1"]);
    expect(input).toMatchObject({
      week: "2026-W45",
      // a nyitás megváltozott: 21:00 budapesti = 20:00 UTC; a zárás érintetlen: a tárolt másodperccel
      opensAt: "2026-11-06T20:00:00.000Z",
      closesAt: "2026-11-13T22:59:59.000Z",
      prizeName: "Aquaforest AF Nano Tank",
      prizeDescription: "Egy kis akvárium.",
      prizeImageId: null,
    });
    expect(api.createQuestion).not.toHaveBeenCalled();
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

  it("a VIEWER sees neither the players' addresses nor a draw (acrobot: game rights are the human roles' only)", async () => {
    auth.session = as("VIEWER");
    render(<GameAdminPage />);
    expect(
      await screen.findByText("Nincs hozzáférésed a nyereményjátékhoz"),
    ).toBeInTheDocument();
    expect(api.questions).not.toHaveBeenCalled();
    expect(api.entries).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Heti sorsolás" })).toBeNull();
  });
  it("shows the mail waiting past the daily cap, and sends it on a press", async () => {
    render(<GameAdminPage />);
    const queue = await screen.findByTestId("game-mail-queue");
    expect(queue).toHaveTextContent(
      "Megerősítő levelek ma: 3000 / 3000 · várakozik: 4",
    );
    fireEvent.click(
      within(queue).getByRole("button", { name: "Várakozó levelek kiküldése" }),
    );
    await waitFor(() => expect(api.sendQueued).toHaveBeenCalledWith("t"));
  });
  it("says why the mail does not go out, and on stage gives the link of an unconfirmed entry", async () => {
    api.entries.mockResolvedValue([
      {
        id: "e3",
        email: "uj@x.hu",
        answer: "acropora",
        autoCorrect: true,
        manualCorrect: null,
        manualAt: null,
        confirmedAt: null,
        createdAt: "2026-11-06T09:00:00.000Z",
        counts: false,
      },
    ]);
    render(<GameAdminPage />);
    expect(await screen.findByText("Ok: path-off")).toBeInTheDocument();
    const entries = await screen.findByTestId("game-entries");
    fireEvent.click(
      await within(entries).findByRole("button", { name: "Teszt-link" }),
    );
    expect(await screen.findByTestId("game-test-link")).toHaveTextContent(
      "megerosites?token=abc",
    );
    expect(api.testLink).toHaveBeenCalledWith("t", "e3");
  });
});
