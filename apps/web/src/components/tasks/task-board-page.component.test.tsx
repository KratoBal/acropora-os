import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, TaskListResponse } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoardPage } from "./task-board-page";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const api = vi.hoisted(() => ({
  listMine: vi.fn(),
  assignees: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  reopen: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/tasks", () => ({ tasksApi: api }));

const session = (role: Session["user"]["role"]): Session => ({
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-balazs",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role,
  },
});

const board = (
  overrides: Partial<TaskListResponse> = {},
): TaskListResponse => ({
  items: [
    {
      id: "task-1",
      title: "Nyers termékexport",
      description:
        "Enélkül polip nem tud importra kész fájlt adni.\nEnnyivel órákat spórolunk az adminban.",
      status: "OPEN",
      linkUrl: "https://discord.com/channels/1/2/3",
      source: "AGENT",
      assignee: { id: "user-balazs", displayName: "Balázs" },
      createdAt: "2026-08-16T10:00:00.000Z",
    },
  ],
  openCount: 1,
  doneCount: 0,
  truncated: false,
  ...overrides,
});

describe("TaskBoardPage", () => {
  beforeEach(() => {
    auth.session = session("OWNER");
    api.listMine.mockReset().mockResolvedValue(board());
    api.assignees
      .mockReset()
      .mockResolvedValue({ items: [{ id: "user-luca", displayName: "Luca" }] });
    api.create.mockReset().mockResolvedValue({});
    api.close.mockReset().mockResolvedValue({});
    api.reopen.mockReset().mockResolvedValue({});
  });

  it("shows the reasoning as body text, not as a truncated footnote", async () => {
    render(<TaskBoardPage />);

    const description = await screen.findByText(/Enélkül polip nem tud/);
    expect(description.className).toContain("whitespace-pre-line");
    expect(description.className).not.toContain("truncate");
    expect(description.className).not.toContain("line-clamp");
    // The reasoning is at least body size and darker than the metadata row,
    // which is the whole point of the tile.
    expect(description.className).toContain("text-sm");
    expect(description.className).toContain("text-slate-700");
  });

  it("links the title to the originating thread, safely", async () => {
    render(<TaskBoardPage />);

    const link = await screen.findByRole("link", {
      name: "Nyers termékexport",
    });
    expect(link).toHaveAttribute("href", "https://discord.com/channels/1/2/3");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("marks machine-created tasks so their origin is visible", async () => {
    render(<TaskBoardPage />);
    expect(await screen.findByText("Flotta")).toBeInTheDocument();
  });

  it("requests only open tasks by default and refetches on filter change", async () => {
    render(<TaskBoardPage />);
    await waitFor(() =>
      expect(api.listMine).toHaveBeenCalledWith(
        "token-1",
        "OPEN",
        expect.anything(),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Lezárt" }));
    await waitFor(() =>
      expect(api.listMine).toHaveBeenCalledWith(
        "token-1",
        "DONE",
        expect.anything(),
      ),
    );
  });

  it("closes a task and reloads the board", async () => {
    render(<TaskBoardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Lezárás" }));

    await waitFor(() =>
      expect(api.close).toHaveBeenCalledWith("token-1", "task-1"),
    );
    await waitFor(() => expect(api.listMine).toHaveBeenCalledTimes(2));
  });

  it("offers reopening for a closed task", async () => {
    api.listMine.mockResolvedValue(
      board({
        items: [
          {
            id: "task-2",
            title: "Kategóriafa",
            status: "DONE",
            source: "MANUAL",
            assignee: { id: "user-balazs", displayName: "Balázs" },
            createdBy: { id: "user-balazs", displayName: "Balázs" },
            closedBy: { id: "user-balazs", displayName: "Balázs" },
            createdAt: "2026-08-16T10:00:00.000Z",
            closedAt: "2026-08-16T12:00:00.000Z",
          },
        ],
        openCount: 0,
        doneCount: 1,
      }),
    );
    render(<TaskBoardPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Újranyitás" }));
    await waitFor(() =>
      expect(api.reopen).toHaveBeenCalledWith("token-1", "task-2"),
    );
  });

  it("creates a task with the reasoning and defaults the assignee to the caller", async () => {
    render(<TaskBoardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Új feladat" }));

    fireEvent.change(screen.getByLabelText("Feladat címe"), {
      target: { value: "  Márkalista  " },
    });
    fireEvent.change(screen.getByLabelText("Indoklás"), {
      target: { value: "A normalizálás így nem találgatás." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Feladat létrehozása" }),
    );

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("token-1", {
        title: "Márkalista",
        description: "A normalizálás így nem találgatás.",
      }),
    );
  });

  it("refuses to submit an empty title without calling the API", async () => {
    render(<TaskBoardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Új feladat" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Feladat létrehozása" }),
    );

    expect(
      await screen.findByText("A feladat címe kötelező."),
    ).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("says out loud when the list was clipped instead of showing a partial list silently", async () => {
    api.listMine.mockResolvedValue(board({ truncated: true }));
    render(<TaskBoardPage />);
    expect(
      await screen.findByText("A lista csonkolva van"),
    ).toBeInTheDocument();
  });

  it("keeps the board usable when the assignee options fail to load", async () => {
    api.assignees.mockRejectedValue(new Error("nem elérhető"));
    render(<TaskBoardPage />);

    expect(await screen.findByText("Nyers termékexport")).toBeInTheDocument();
    expect(screen.queryByText("Hiba")).not.toBeInTheDocument();
  });
});
