import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CatalogActionRun, CatalogActionsResponse } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APPLY_RECOMPUTES, CatalogActionsPanel } from "./catalog-actions-panel";

/*
  THE BRANDS PAGE CATALOG BUTTONS (kezdolap-marka-sav-os). What turns this red:
  the panel showing where the server says the operations do not exist
  (production); an apply that can be started without a successful plan, or
  without the confirmation; an apply sent with another plan than the one shown.
*/
const api = vi.hoisted(() => ({
  overview: vi.fn(),
  run: vi.fn(),
  plan: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/lib/api/catalog-actions", () => ({ catalogActionsApi: api }));

function run(overrides: Partial<CatalogActionRun>): CatalogActionRun {
  return {
    id: "run-1",
    kind: "brand-backfill",
    mode: "plan",
    status: "succeeded",
    startedAt: "2026-10-27T12:00:00.000Z",
    finishedAt: "2026-10-27T12:00:05.000Z",
    actorUserId: "user-1",
    exitCode: 0,
    output: "Márkát kapna: 683 termék\n",
    error: null,
    planRunId: null,
    appliedByRunId: null,
    ...overrides,
  };
}

function enabled(
  lastRun: CatalogActionRun | null = null,
  categoriesRun: CatalogActionRun | null = null,
): CatalogActionsResponse {
  return {
    enabled: true,
    actions: [
      {
        kind: "brand-backfill",
        title: "Márkák a termékekre",
        description: "backfill",
        lastRun,
      },
      {
        kind: "brand-links",
        title: "Márka-kötések átvitele",
        description: "links",
        lastRun: null,
      },
      {
        kind: "categories",
        title: "Kategóriák a teszt webshopban",
        description: "categories",
        lastRun: categoriesRun,
      },
    ],
  };
}

const section = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("CatalogActionsPanel", () => {
  it("renders nothing where the server says the operations do not exist", async () => {
    api.overview.mockResolvedValue({ enabled: false, actions: [] });
    const { container } = render(<CatalogActionsPanel token="t" />);
    await waitFor(() =>
      expect(api.overview).toHaveBeenCalledWith("t", expect.anything()),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("the apply waits for a successful plan", async () => {
    api.overview.mockResolvedValue(enabled());
    render(<CatalogActionsPanel token="t" />);
    const backfill = await screen.findByRole("region", {
      name: "Márkák a termékekre",
    });
    expect(
      within(backfill).getByRole("button", { name: "Végrehajtás" }),
    ).toBeDisabled();

    api.plan.mockResolvedValue(run({ status: "failed", exitCode: 1 }));
    fireEvent.click(within(backfill).getByRole("button", { name: "Próba" }));
    await waitFor(() =>
      expect(api.plan).toHaveBeenCalledWith("t", "brand-backfill"),
    );
    await within(backfill).findByText("Próba: hiba");
    expect(
      within(backfill).getByRole("button", { name: "Végrehajtás" }),
    ).toBeDisabled();
  });

  it("a plan already used by an apply does not confirm another", async () => {
    api.overview.mockResolvedValue(enabled(run({ appliedByRunId: "run-2" })));
    render(<CatalogActionsPanel token="t" />);
    const backfill = await screen.findByRole("region", {
      name: "Márkák a termékekre",
    });
    expect(
      within(backfill).getByRole("button", { name: "Végrehajtás" }),
    ).toBeDisabled();
  });

  it("the apply goes out only after the confirmation, with the plan that was shown", async () => {
    api.overview.mockResolvedValue(enabled(run({ id: "plan-7" })));
    api.apply.mockResolvedValue(
      run({
        id: "apply-1",
        mode: "apply",
        status: "running",
        planRunId: "plan-7",
        finishedAt: null,
        exitCode: null,
        output: "",
      }),
    );
    render(<CatalogActionsPanel token="t" />);
    const backfill = await screen.findByRole("region", {
      name: "Márkák a termékekre",
    });
    fireEvent.click(
      within(backfill).getByRole("button", { name: "Végrehajtás" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByLabelText("A próba összesítője"),
    ).toHaveTextContent("Márkát kapna: 683 termék");
    expect(api.apply).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Végrehajtás",
      }),
    );
    await waitFor(() =>
      expect(api.apply).toHaveBeenCalledWith("t", "brand-backfill", "plan-7"),
    );
    await within(backfill).findByText("Végrehajtás: fut");
    // the plan stays in view next to the running apply
    expect(
      within(backfill).getByLabelText("A próba összesítője"),
    ).toHaveTextContent("Márkát kapna: 683 termék");
  });

  /*
    THE CATEGORIES' CONFIRMATION (#1910) NAMES ITS OWN CONSEQUENCE and the one
    trace the apply leaves out: the old id lives only in the plan's output.
    A kind without its text would get the generic "A művelet ír."
  */
  it("the categories' confirmation names the adoption and tells to save the plan's output", async () => {
    api.overview.mockResolvedValue(
      enabled(
        null,
        run({
          id: "plan-cat",
          kind: "categories",
          output: "Örökbefogadás: 219\n",
        }),
      ),
    );
    render(<CatalogActionsPanel token="t" />);
    const categories = await screen.findByRole("region", {
      name: "Kategóriák a teszt webshopban",
    });
    fireEvent.click(
      within(categories).getByRole("button", { name: "Végrehajtás" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("megkapják a mi azonosítónkat");
    expect(dialog).toHaveTextContent("mentsd el a végrehajtás előtt");
    expect(dialog).toHaveTextContent("az Ellenőrzés sort nézd meg");
    expect(dialog).not.toHaveTextContent("A művelet ír.");
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("the confirmation does not promise the plan's set: the apply recomputes", async () => {
    api.overview.mockResolvedValue(enabled(run({ id: "plan-7" })));
    render(<CatalogActionsPanel token="t" />);
    const backfill = await screen.findByRole("region", {
      name: "Márkák a termékekre",
    });
    fireEvent.click(
      within(backfill).getByRole("button", { name: "Végrehajtás" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(APPLY_RECOMPUTES);
    expect(dialog).not.toHaveTextContent(/a próba szerint/i);
  });

  it("after a reload, a finished apply is shown with the summary of the plan it was confirmed from", async () => {
    api.overview.mockResolvedValue(
      enabled(
        run({
          id: "apply-1",
          mode: "apply",
          planRunId: "plan-7",
          output: "Termék, amire márka került: 681\n",
        }),
      ),
    );
    api.run.mockResolvedValue(run({ id: "plan-7" }));
    render(<CatalogActionsPanel token="t" />);
    const backfill = await screen.findByRole("region", {
      name: "Márkák a termékekre",
    });
    expect(
      await within(backfill).findByLabelText("A próba összesítője"),
    ).toHaveTextContent("Márkát kapna: 683 termék");
    expect(
      within(backfill).getByLabelText("A végrehajtás összesítője"),
    ).toHaveTextContent("Termék, amire márka került: 681");
    expect(api.run).toHaveBeenCalledWith("t", "plan-7", expect.anything());
  });

  it("while a run is running, no other run can be started, and the run is asked about again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.overview.mockResolvedValue(
        enabled(run({ status: "running", finishedAt: null, exitCode: null })),
      );
      api.run.mockResolvedValue(run({ output: "kész\n" }));
      render(<CatalogActionsPanel token="t" />);
      const links = await screen.findByRole("region", {
        name: "Márka-kötések átvitele",
      });
      expect(
        within(links).getByRole("button", { name: "Próba" }),
      ).toBeDisabled();
      await vi.advanceTimersByTimeAsync(2100);
      await waitFor(() => expect(api.run).toHaveBeenCalledWith("t", "run-1"));
      await waitFor(() =>
        expect(
          within(links).getByRole("button", { name: "Próba" }),
        ).toBeEnabled(),
      );
      expect(section("Márkák a termékekre")).toHaveTextContent("Próba: kész");
    } finally {
      vi.useRealTimers();
    }
  });
});
