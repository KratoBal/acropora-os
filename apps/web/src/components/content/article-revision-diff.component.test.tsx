import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ArticleRevisionDiff } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArticleRevisions } from "./article-revision-diff";

/*
  THE ARTICLE'S REVISIONS COMPARED (research plan v4, 9.2 S5). What turns this
  red: a revision compared with the wrong neighbour (the list is newest first,
  so the older one is the next row); the newest one not comparable with the
  saved text; a changed word not marked as removed and added; unsaved edits
  shown as if they were in the comparison.
*/
const api = vi.hoisted(() => ({ articleDiff: vi.fn() }));
vi.mock("@/lib/api/content", () => ({ contentApi: api }));

const revisions = [
  {
    id: "r2",
    approvedAt: "2026-10-27T10:00:00.000Z",
    approvedById: "u",
    contentHash: "b",
  },
  {
    id: "r1",
    approvedAt: "2026-10-26T10:00:00.000Z",
    approvedById: "u",
    contentHash: "a",
  },
];

const diff: ArticleRevisionDiff = {
  from: { kind: "revision", id: "r2", approvedAt: "2026-10-27T10:00:00.000Z" },
  to: { kind: "current", updatedAt: "2026-10-27T11:00:00.000Z" },
  fields: [{ field: "title", before: "Foszfát", after: "Foszfát SPS-ben" }],
  body: [
    { kind: "same", text: "Bevezető bekezdés." },
    {
      kind: "changed",
      segments: [
        { kind: "same", text: "A határ " },
        { kind: "removed", text: "0,05" },
        { kind: "added", text: "0,1" },
        { kind: "same", text: " mg/l." },
      ],
    },
    { kind: "added", text: "Új zárás." },
  ],
  identical: false,
};

function renderIt(dirty = false) {
  render(
    <ArticleRevisions
      token="token-1"
      contentId="c1"
      revisions={revisions}
      approvedRevisionId="r2"
      publishedRevisionId="r1"
      dirty={dirty}
    />,
  );
}

describe("ArticleRevisions", () => {
  beforeEach(() => {
    api.articleDiff.mockReset();
    api.articleDiff.mockResolvedValue(diff);
  });

  it("compares a revision with the one before it, and only the newest with the saved text", () => {
    renderIt();
    const older = screen.getAllByRole("button", { name: "Az előzőhöz képest" });
    expect(older).toHaveLength(1);
    fireEvent.click(older[0]!);
    expect(api.articleDiff).toHaveBeenCalledWith(
      "token-1",
      "c1",
      "r1",
      "r2",
      expect.any(AbortSignal),
    );
    const current = screen.getAllByRole("button", {
      name: "A mostani szöveghez képest",
    });
    expect(current).toHaveLength(1);
    fireEvent.click(current[0]!);
    expect(api.articleDiff).toHaveBeenLastCalledWith(
      "token-1",
      "c1",
      "r2",
      "current",
      expect.any(AbortSignal),
    );
  });

  it("marks the changed words and the fields, and says when unsaved edits are left out", async () => {
    renderIt(true);
    fireEvent.click(
      screen.getByRole("button", { name: "A mostani szöveghez képest" }),
    );
    await waitFor(() => expect(screen.getByText("0,05").tagName).toBe("DEL"));
    expect(screen.getByText("0,1").tagName).toBe("INS");
    expect(screen.getByText("Foszfát SPS-ben").tagName).toBe("INS");
    expect(
      screen.getByText("Új zárás.").closest("[data-diff]"),
    ).toHaveAttribute("data-diff", "added");
    expect(
      screen.getByText(/A még nem mentett módosítások nincsenek benne/),
    ).toBeInTheDocument();
  });

  it("draws the newest comparison when an older answer arrives later", async () => {
    let finishOld: (value: ArticleRevisionDiff) => void = () => {};
    api.articleDiff
      .mockImplementationOnce(
        () =>
          new Promise<ArticleRevisionDiff>((resolve) => (finishOld = resolve)),
      )
      .mockResolvedValueOnce(diff);
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Az előzőhöz képest" }));
    const first = api.articleDiff.mock.calls[0]![4] as AbortSignal;
    fireEvent.click(
      screen.getByRole("button", { name: "A mostani szöveghez képest" }),
    );
    expect(first.aborted).toBe(true);
    await screen.findByText("Új zárás.");
    finishOld({ ...diff, body: [{ kind: "added", text: "Régi válasz." }] });
    await Promise.resolve();
    expect(screen.queryByText("Régi válasz.")).toBeNull();
    expect(screen.getByText("Új zárás.")).toBeInTheDocument();
  });

  it("names the error the server gave", async () => {
    api.articleDiff.mockRejectedValue(
      new Error("Nincs ilyen változata ennek a cikknek."),
    );
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Az előzőhöz képest" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nincs ilyen változata ennek a cikknek.",
    );
  });
});
