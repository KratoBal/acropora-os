import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArticleCitationReport } from "@/lib/api/knowledge-base";

import { ArticleCitationsPanel } from "./article-citations-panel";

/*
  AN ARTICLE'S CITATIONS IN THE EDITOR (research plan v4, 9.2 S5). What turns
  this red: a sentence's status not shown; a citation shown without what it
  points at; a warning answered without a reason, or with codes the server did
  not name; a write offered to a reader without knowledge.manage, or while the
  article waits for approval; a not-technical mark saved without its reason.
*/
const api = vi.hoisted(() => ({
  citations: vi.fn(),
  claimStore: vi.fn(),
  conclusions: vi.fn(),
  addCitation: vi.fn(),
  removeCitation: vi.fn(),
  answerCitation: vi.fn(),
}));
vi.mock("@/lib/api/knowledge-base", () => ({ knowledgeBaseApi: api }));

const report = (
  over: Partial<ArticleCitationReport> = {},
): ArticleCitationReport => ({
  contentId: "a1",
  editable: true,
  vocabulary: { version: 1, status: "APPROVED" },
  sentences: [
    { sentence: "Bevezetés.", status: "UNCITED", citations: [] },
    {
      sentence: "A foszfát 0,5 mg/l mellett csökkentette a kalcifikációt.",
      status: "WARNING",
      citations: [
        {
          id: "cit1",
          kind: "CLAIM",
          problems: [],
          warnings: [
            {
              row: "QUANTITY",
              code: "QUANTITY_OUT_OF_RANGE",
              detail: "0,5 mg/l, the evidence 0.03-0.09",
            },
          ],
          unanswered: ["QUANTITY_OUT_OF_RANGE"],
        },
      ],
    },
  ],
  orphaned: [],
  blockers: [],
  counts: {
    sentences: 2,
    uncited: 1,
    invalid: 0,
    unansweredWarnings: 1,
    orphaned: 0,
  },
  clean: false,
  targets: [
    {
      id: "cit1",
      kind: "CLAIM",
      claimId: "c1",
      conclusionId: null,
      reason: null,
    },
  ],
  ...over,
});

function renderIt(canEdit = true, over: Partial<ArticleCitationReport> = {}) {
  api.citations.mockResolvedValue(report(over));
  render(
    <ArticleCitationsPanel
      token="t"
      contentId="a1"
      canEdit={canEdit}
      reloadKey={0}
      dirty={false}
    />,
  );
}

describe("ArticleCitationsPanel", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.claimStore.mockResolvedValue({
      claims: [{ id: "c1", title: "Kalcifikáció: csökken" }],
      total: 1,
      layers: {},
    });
    api.conclusions.mockResolvedValue([]);
  });

  it("shows each sentence's status and what its citation points at", async () => {
    renderIt();
    expect(await screen.findByText("nincs hivatkozás")).toBeInTheDocument();
    expect(
      screen.getByText("megválaszolatlan figyelmeztetés"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Állítás: Kalcifikáció: csökken"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("citation-summary")).toHaveTextContent(
      "2 mondat · 1 hivatkozás nélkül · 0 hibás · 1 megválaszolatlan figyelmeztetés",
    );
  });

  it("answers the server's codes with the reason given, and only with a reason", async () => {
    api.answerCitation.mockResolvedValue(report());
    renderIt();
    const button = await screen.findByRole("button", {
      name: "Elfogadom okkal",
    });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Az elfogadás oka"), {
      target: { value: "kerekítés" },
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.answerCitation).toHaveBeenCalledWith(
        "t",
        "a1",
        "cit1",
        ["QUANTITY_OUT_OF_RANGE"],
        "kerekítés",
      ),
    );
  });

  it("saves a not-technical mark only with its reason", async () => {
    api.addCitation.mockResolvedValue(report());
    renderIt();
    fireEvent.click(
      (
        await screen.findAllByRole("button", { name: "Hivatkozás hozzáadása" })
      )[0]!,
    );
    fireEvent.change(screen.getByLabelText("A hivatkozás fajtája"), {
      target: { value: "NOT_TECHNICAL" },
    });
    const save = screen.getByRole("button", { name: "Hivatkozás mentése" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Miért nem szakmai a mondat"), {
      target: { value: "bevezető" },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.addCitation).toHaveBeenCalledWith("t", "a1", {
        sentence: "Bevezetés.",
        kind: "NOT_TECHNICAL",
        reason: "bevezető",
      }),
    );
  });

  it("asks before it removes a citation, and removes only after the answer", async () => {
    api.removeCitation.mockResolvedValue(report());
    renderIt();
    fireEvent.click(
      await screen.findByRole("button", { name: "Hivatkozás törlése" }),
    );
    expect(api.removeCitation).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "Törlöd ezt a hivatkozást?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Hivatkozás törlése" }),
    );
    await waitFor(() =>
      expect(api.removeCitation).toHaveBeenCalledWith("t", "a1", "cit1"),
    );
  });

  it("offers no write without knowledge.manage, nor while the article waits for approval", async () => {
    renderIt(false);
    await screen.findByText("nincs hivatkozás");
    expect(
      screen.queryByRole("button", { name: "Hivatkozás hozzáadása" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Elfogadom okkal" }),
    ).toBeNull();
  });

  it("offers no write on an article that is not editable", async () => {
    renderIt(true, { editable: false });
    await screen.findByText("nincs hivatkozás");
    expect(
      screen.queryByRole("button", { name: "Hivatkozás törlése" }),
    ).toBeNull();
    expect(
      screen.getByText(
        /a hivatkozások csak javításra visszaküldve módosíthatók/,
      ),
    ).toBeInTheDocument();
  });
});
