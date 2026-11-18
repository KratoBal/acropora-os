import { render, screen, within } from "@testing-library/react";
import {
  USER_ROLES,
  type MedusaRedirectPlanView,
  type Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  REDIRECT_PLAN_STATE_LABELS,
  MedusaRedirectPlanPage,
} from "./medusa-redirect-plan-page";

/*
  A VETÍTÉS TERVÉNEK LAPJA (task t-20261118-vetites-oldal; a #2677 végpontja). WHAT TURNS IT RED: the state shown wrong (a chain refusal looking like a plan to
  send, an in-sync list looking like a change); the counts of the two lists or of added, changed and removed missing; the examples missing, or the
  whole count hidden behind the first twenty; the removed rows not saying they would DISAPPEAR; the reason of a refusal missing; the retargeted
  counts missing; the loading, error (the shop unreachable), no-permission states wrong; the API called without the right.
*/
const api = vi.hoisted(() => ({ get: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/medusa-redirect-plan", () => ({
  medusaRedirectPlanApi: api,
}));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-pilot" }),
}));

const session = (role: Session["user"]["role"]): Session => ({
  id: `session-${role}`,
  token: `token-${role}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: role,
    email: `${role.toLowerCase()}@acropora.local`,
    displayName: role,
    role,
    customerId: null,
    supplierId: null,
  },
});

const plan = (
  over: Partial<MedusaRedirectPlanView> = {},
): MedusaRedirectPlanView => ({
  state: "would-send",
  refusedReason: null,
  localCount: 2310,
  remoteCount: 2297,
  localHash: "a1b2c3d4e5f6a7b8c9d0",
  remoteHash: "ffeeddccbbaa00998877",
  added: {
    count: 13,
    examples: [
      {
        source: "/ATI-Straton-X-lampafuggeszto",
        destination: "/hu/termek/ati-straton-x-lampafuggeszto",
        status: 301,
      },
    ],
  },
  changed: {
    count: 1,
    examples: [
      {
        source: "/Eden-135",
        from: { destination: "/hu/termek/regi", status: 301 },
        to: { destination: "/hu/termek/uj", status: 301 },
      },
    ],
  },
  removed: {
    count: 2,
    examples: [
      {
        source: "/Torolt-cim",
        destination: "/hu/termek/torolt",
        status: 301,
      },
    ],
  },
  unchanged: 2296,
  retargeted: { brand: 3, gone: 7, moved: 5 },
  ...over,
});

describe("MedusaRedirectPlanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session(USER_ROLES[0] as Session["user"]["role"]);
    api.get.mockResolvedValue(plan());
  });

  it("shows the state, the counts of both lists, and the three kinds of difference with their whole counts", async () => {
    render(<MedusaRedirectPlanPage />);
    expect(
      await screen.findByText(REDIRECT_PLAN_STATE_LABELS["would-send"]),
    ).toBeTruthy();
    expect(screen.getByTestId("redirect-plan-counts").textContent).toContain(
      "2310",
    );
    expect(screen.getByTestId("redirect-plan-counts").textContent).toContain(
      "2297",
    );
    expect(screen.getByTestId("redirect-plan-added").textContent).toContain(
      "13",
    );
    expect(screen.getByTestId("redirect-plan-changed").textContent).toContain(
      "1",
    );
    expect(screen.getByTestId("redirect-plan-removed").textContent).toContain(
      "2",
    );
    expect(api.get).toHaveBeenCalledWith("token-OWNER", expect.anything());
  });

  it("lists the examples: an added row, a changed row with before and after, a removed row", async () => {
    render(<MedusaRedirectPlanPage />);
    const added = await screen.findByTestId("redirect-plan-added");
    expect(
      within(added).getByText("/ATI-Straton-X-lampafuggeszto"),
    ).toBeTruthy();
    expect(
      within(added).getByText("/hu/termek/ati-straton-x-lampafuggeszto"),
    ).toBeTruthy();
    const changed = screen.getByTestId("redirect-plan-changed");
    expect(within(changed).getByText("/Eden-135")).toBeTruthy();
    expect(within(changed).getByText(/\/hu\/termek\/regi/)).toBeTruthy();
    expect(within(changed).getByText(/\/hu\/termek\/uj/)).toBeTruthy();
    const removed = screen.getByTestId("redirect-plan-removed");
    expect(within(removed).getByText("/Torolt-cim")).toBeTruthy();
  });

  it("says that the removed rows would DISAPPEAR, and that only the first examples are shown when there are more", async () => {
    render(<MedusaRedirectPlanPage />);
    const removed = await screen.findByTestId("redirect-plan-removed");
    expect(removed.textContent).toMatch(/eltűn/i);
    // 13 darab van, 1 példa látszik: a lap kimondja, hogy a lista csonka
    expect(screen.getByTestId("redirect-plan-added").textContent).toMatch(
      /az első 1 látszik/,
    );
  });

  it("shows the retargeted counts (brand page, 410, moved), each with its own number", async () => {
    render(<MedusaRedirectPlanPage />);
    const line = await screen.findByTestId("redirect-plan-retargeted");
    expect(line.textContent).toContain("3 sor a márkalapra");
    expect(line.textContent).toContain("7 sor 410-zel");
    expect(line.textContent).toContain("5 sor a helyettesítőre");
  });

  it("an in-sync list says so and shows no difference section", async () => {
    api.get.mockResolvedValue(
      plan({
        state: "in-sync",
        remoteCount: 2310,
        remoteHash: "a1b2c3d4e5f6a7b8c9d0",
        added: { count: 0, examples: [] },
        changed: { count: 0, examples: [] },
        removed: { count: 0, examples: [] },
        unchanged: 2310,
      }),
    );
    render(<MedusaRedirectPlanPage />);
    expect(
      await screen.findByText(REDIRECT_PLAN_STATE_LABELS["in-sync"]),
    ).toBeTruthy();
    expect(screen.queryByTestId("redirect-plan-added")).toBeNull();
    expect(screen.queryByTestId("redirect-plan-changed")).toBeNull();
    expect(screen.queryByTestId("redirect-plan-removed")).toBeNull();
  });

  it("a refusal names the chain and does not look like a plan to send", async () => {
    api.get.mockResolvedValue(
      plan({
        state: "refused",
        refusedReason: "chain: /a -> /b, which is itself a source",
      }),
    );
    render(<MedusaRedirectPlanPage />);
    expect(
      await screen.findByText(REDIRECT_PLAN_STATE_LABELS.refused),
    ).toBeTruthy();
    expect(
      screen.getByText("chain: /a -> /b, which is itself a source"),
    ).toBeTruthy();
    expect(
      screen.queryByText(REDIRECT_PLAN_STATE_LABELS["would-send"]),
    ).toBeNull();
  });

  it("shows a loading state, and the sentence of an unreachable shop for a 503", async () => {
    api.get.mockRejectedValue(new ApiError("MEDUSA_NOT_CONFIGURED", 503));
    render(<MedusaRedirectPlanPage />);
    expect(screen.getByLabelText("A terv betöltése")).toBeTruthy();
    expect(
      await screen.findByText(/A webshop most nem érhető el/),
    ).toBeTruthy();
  });

  it("another error is the generic sentence, and a user without the right sees no data and the API is not called", async () => {
    api.get.mockRejectedValue(new ApiError("x", 500));
    const { unmount } = render(<MedusaRedirectPlanPage />);
    expect(await screen.findByText("A terv nem tölthető be.")).toBeTruthy();
    unmount();
    api.get.mockClear();
    api.get.mockResolvedValue(plan());
    auth.session = null;
    render(<MedusaRedirectPlanPage />);
    expect(
      screen.getByText("Ehhez a laphoz nincs jogosultságod."),
    ).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });
});
