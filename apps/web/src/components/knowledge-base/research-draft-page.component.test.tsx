import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ResearchDraftClaim,
  ResearchDraftDetail,
  ResearchDraftRow,
  ResearchDraftSource,
} from "@/lib/api/knowledge-base";
import { KnowledgeBaseTabs } from "./knowledge-base-tabs";
import {
  RESEARCH_DRAFT_POLL_MS,
  ResearchDraftPage,
  safeHref,
  summaryParts,
} from "./research-draft-page";

/*
  RESEARCH DRAFTS, MODE B (research S6, Figma 3:472). What turns this red: a
  summary shown without its "model text from external sources" mark, or in the
  look of an accepted claim; a marker that does not lead to its candidate
  claim; a source address that is not http(s) rendered as a link; a FAILED
  draft without its reason; a second run offered while one runs; the screen or
  its tab offered to a role without knowledge.manage (every endpoint asks it);
  a RUNNING draft that is not read back until it settles.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tudasbazis/ai-proba",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  researchDrafts: vi.fn(),
  researchDraft: vi.fn(),
  startResearchDraft: vi.fn(),
  vocabulary: vi.fn(),
}));
vi.mock("@/lib/api/knowledge-base", () => ({ knowledgeBaseApi: api }));

const auth = vi.hoisted(() => ({ role: "OWNER" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "U",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const row = (over: Partial<ResearchDraftRow> = {}): ResearchDraftRow => ({
  id: "d1",
  question: "Milyen foszfátszint jó egy SPS-akváriumban?",
  status: "DRAFT",
  summaryModel: "gpt-test research-summary/v1",
  createdById: "u",
  createdAt: "2026-10-28T01:00:00.000Z",
  finishedAt: "2026-10-28T01:03:00.000Z",
  ...over,
});

const source = (
  over: Partial<ResearchDraftSource> = {},
): ResearchDraftSource => ({
  doi: "10.1000/koop",
  pmcid: "PMC1",
  pmid: null,
  title: "Phosphate and coral calcification",
  authors: ["Koop K", "Booth D"],
  year: 2001,
  venue: "Marine Pollution Bulletin",
  url: "https://europepmc.org/article/PMC/PMC1",
  licence: "CC-BY",
  read: "READ",
  claims: 1,
  retractionUnchecked: false,
  ...over,
});

const claim = (over: Partial<ResearchDraftClaim> = {}): ResearchDraftClaim => ({
  id: "c1",
  source: 0,
  passage: {
    text: "Calcification decreased at 0.3 mg/l PO4.",
    locator: "results p2",
  },
  species: "ACROPORA",
  environment: "LAB",
  effect: "CALCIFICATION",
  direction: "DECREASE",
  quantity: { min: 0.3, max: 0.3, unit: "mg/l", basis: "PO4" },
  studyType: "CONTROLLED_LAB",
  measurementMethod: null,
  sampleSize: null,
  uncertainty: null,
  conditions: null,
  ...over,
});

const detail = (
  over: Partial<ResearchDraftDetail> = {},
): ResearchDraftDetail => ({
  ...row(),
  summary:
    "A kalcifikáció 0.3 mg/l PO4 mellett csökkent [[claim:c1]]. Egy másik mondat [[claim:c9]].",
  sources: [source()],
  candidateClaims: [claim()],
  report: {
    queries: ["phosphate coral calcification"],
    summaryDroppedHere: ["UNMARKED"],
    summaryMarkersMoved: 2,
    summaryDroppedByAi: [],
  },
  ...over,
});

beforeEach(() => {
  auth.role = "OWNER";
  for (const fn of Object.values(api)) fn.mockReset();
  api.researchDrafts.mockResolvedValue([row()]);
  api.researchDraft.mockResolvedValue(detail());
  api.vocabulary.mockResolvedValue({
    entries: [
      { kind: "TAXON", key: "ACROPORA", label: "Acropora" },
      { kind: "EFFECT", key: "CALCIFICATION", label: "Kalcifikáció" },
    ],
  });
});
afterEach(() => vi.useRealTimers());

describe("ResearchDraftPage", () => {
  it("marks the summary as model text and links each known marker to its candidate claim", async () => {
    render(<ResearchDraftPage />);
    const summary = await screen.findByRole("region", {
      name: "Modell-szöveg külső forrásokból",
    });
    expect(
      within(summary).getByText(
        "Modell-szöveg külső forrásokból · nem ellenőrzött",
      ),
    ).toBeInTheDocument();
    expect(within(summary).getByText(/gpt-test/)).toBeInTheDocument();
    expect(within(summary).getByRole("link", { name: "[c1]" })).toHaveAttribute(
      "href",
      "#kutatasi-allitas-c1",
    );
    // a marker without a claim on the page is shown, but leads nowhere
    expect(within(summary).queryByRole("link", { name: "[c9]" })).toBeNull();
    expect(within(summary).getByText("[c9]")).toBeInTheDocument();

    const item = document.getElementById("kutatasi-allitas-c1")!;
    expect(within(item).getByText("Jelölt · nem ellenőrzött")).toBeVisible();
    // the vocabulary names the keys it knows; an unknown key shows as it is
    expect(within(item).getByText("Acropora")).toBeInTheDocument();
    expect(within(item).getByText("Kalcifikáció")).toBeInTheDocument();
    expect(within(item).getByText("LAB")).toBeInTheDocument();
    expect(within(item).getByText("Csökken")).toBeInTheDocument();
    expect(within(item).getByText("0,3 mg/l PO₄")).toBeInTheDocument();
    expect(within(item).getByText("Koop et al., 2001")).toBeInTheDocument();
    expect(
      screen.getByText("Kiszűrt mondatok: 1 · csak belső nézet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 mondat: nincs állítás-hivatkozás a mondat végén"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 helyen a pont után álló jelölőt/),
    ).toBeInTheDocument();
  });

  it("links a source only to an http(s) address, and says when no DOI covered the retraction check", async () => {
    api.researchDraft.mockResolvedValue(
      detail({
        sources: [
          source(),
          source({
            title: "No DOI work",
            doi: null,
            url: "javascript:alert(1)",
            read: "NOT_TRIED",
            retractionUnchecked: true,
          }),
          source({
            title: "Program Abstracts",
            read: "ABSTRACT_BOOK",
          }),
        ],
      }),
    );
    render(<ResearchDraftPage />);
    expect(
      await screen.findByRole("link", {
        name: "Phosphate and coral calcification",
      }),
    ).toHaveAttribute("href", "https://europepmc.org/article/PMC/PMC1");
    expect(screen.queryByRole("link", { name: "No DOI work" })).toBeNull();
    expect(screen.getByText("Nem került sorra")).toBeInTheDocument();
    expect(
      screen.getByText("Absztrakt-kötet: nem olvastuk"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nincs DOI: a visszavonást csak/),
    ).toBeInTheDocument();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });

  it("says why a FAILED draft has no summary, and shows no model text", async () => {
    api.researchDrafts.mockResolvedValue([row({ status: "FAILED" })]);
    api.researchDraft.mockResolvedValue(
      detail({
        status: "FAILED",
        summary: null,
        summaryModel: null,
        candidateClaims: [],
        report: { reason: "NO_CLAIMS", queries: ["q"] },
      }),
    );
    render(<ResearchDraftPage />);
    expect(
      await screen.findByText(/egyetlen állítás sem ment át/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Modell-szöveg külső forrásokból" }),
    ).toBeNull();
  });

  it("names a stale run's end as well", async () => {
    api.researchDrafts.mockResolvedValue([row({ status: "FAILED" })]);
    api.researchDraft.mockResolvedValue(
      detail({
        status: "FAILED",
        summary: null,
        report: { error: "STALE_RUNNING" },
      }),
    );
    render(<ResearchDraftPage />);
    expect(await screen.findByText(/A futás megszakadt/)).toBeInTheDocument();
  });

  it("starts a run with the trimmed question and reads the RUNNING draft back until it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.researchDrafts.mockResolvedValue([]);
    api.startResearchDraft.mockResolvedValue({ id: "d2", status: "RUNNING" });
    render(<ResearchDraftPage />);
    expect(
      await screen.findByText(/Még nincs kutatási tervezet/),
    ).toBeInTheDocument();
    const startButton = screen.getByRole("button", {
      name: "Kutatás indítása",
    });
    expect(startButton).toBeDisabled();

    const running = detail({
      id: "d2",
      status: "RUNNING",
      summary: null,
      summaryModel: null,
      sources: [],
      candidateClaims: [],
      report: {},
      finishedAt: null,
    });
    api.researchDraft.mockResolvedValueOnce(running);
    api.researchDrafts.mockResolvedValue([
      row({ id: "d2", status: "RUNNING" }),
    ]);
    fireEvent.change(screen.getByLabelText("Kérdés"), {
      target: { value: "  Mennyi foszfát?  " },
    });
    fireEvent.click(startButton);
    await waitFor(() =>
      expect(api.startResearchDraft).toHaveBeenCalledWith(
        "token-1",
        "Mennyi foszfát?",
      ),
    );
    expect(await screen.findByText(/A kutatás fut/)).toBeInTheDocument();
    // one run at a time: the button waits while a draft runs
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Kutatás indítása" }),
      ).toBeDisabled(),
    );

    api.researchDraft.mockResolvedValue(detail({ id: "d2" }));
    api.researchDrafts.mockResolvedValue([row({ id: "d2" })]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESEARCH_DRAFT_POLL_MS);
    });
    expect(
      await screen.findByRole("region", {
        name: "Modell-szöveg külső forrásokból",
      }),
    ).toBeInTheDocument();
    expect(api.researchDraft).toHaveBeenLastCalledWith(
      "token-1",
      "d2",
      expect.anything(),
    );
    // settled: the list was read again, and nothing polls any more
    await waitFor(() => expect(api.researchDrafts).toHaveBeenCalledTimes(3));
    const calls = api.researchDraft.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESEARCH_DRAFT_POLL_MS * 2);
    });
    expect(api.researchDraft.mock.calls.length).toBe(calls);
  });

  it("shows the server's refusal when a run does not start", async () => {
    api.startResearchDraft.mockRejectedValue(
      new Error(
        "Már fut egy kutatási tervezet, felderítés vagy kiolvasás; egyszerre egy futhat.",
      ),
    );
    render(<ResearchDraftPage />);
    fireEvent.change(await screen.findByLabelText("Kérdés"), {
      target: { value: "Mennyi foszfát?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kutatás indítása" }));
    expect(await screen.findByText(/egyszerre egy futhat/)).toBeInTheDocument();
  });

  it("offers neither the screen nor its tab to a reader without knowledge.manage", async () => {
    auth.role = "MANAGER";
    render(<ResearchDraftPage />);
    expect(screen.getByText(/knowledge.manage jog kell/)).toBeInTheDocument();
    expect(api.researchDrafts).not.toHaveBeenCalled();
    expect(api.researchDraft).not.toHaveBeenCalled();

    const { container } = render(
      <KnowledgeBaseTabs active="/tudasbazis/forrasok" />,
    );
    expect(within(container).getByText("Források")).toBeInTheDocument();
    expect(within(container).queryByText("AI próba")).toBeNull();
  });

  it("shows the tab to an editor", () => {
    const { container } = render(
      <KnowledgeBaseTabs active="/tudasbazis/forrasok" />,
    );
    expect(within(container).getByText("AI próba")).toBeInTheDocument();
  });
});

describe("summaryParts", () => {
  it("splits the text at the markers and keeps the rest", () => {
    expect(summaryParts("A [[claim:c1]][[claim:c2]]. B")).toEqual([
      { text: "A " },
      { claim: "c1" },
      { claim: "c2" },
      { text: ". B" },
    ]);
  });
});
