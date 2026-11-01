import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeConclusion } from "@/lib/api/knowledge-base";
import { ConclusionsPage } from "./conclusions-page";

/*
  OWN CONCLUSIONS (research S5, Figma 3:275). What turns this red: a
  conclusion saved without a claim, a text or a reasoning; an approval or a
  withdrawal offered to a role without knowledge.approve; a draft offered for
  editing to a role without knowledge.manage; a withdrawal without a reason; an
  approved conclusion that can still be edited.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tudasbazis/kovetkeztetesek",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  conclusions: vi.fn(),
  claimStore: vi.fn(),
  createConclusion: vi.fn(),
  updateConclusion: vi.fn(),
  approveConclusion: vi.fn(),
  withdrawConclusion: vi.fn(),
  modelFlags: vi.fn(),
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

const conclusion = (
  over: Partial<KnowledgeConclusion> = {},
): KnowledgeConclusion => ({
  id: "k1",
  text: "Az SPS-rendszerek foszfátigénye nem szűkíthető egy értékre.",
  reasoning: "Két kontrollált kísérlet eltérő tartományt ad.",
  status: "DRAFT",
  revision: 1,
  claims: [{ id: "c1", status: "VERIFIED" }],
  citationCount: 0,
  approvedAt: null,
  withdrawnReason: null,
  updatedAt: "2026-10-27T18:00:00.000Z",
  ...over,
});

beforeEach(() => {
  auth.role = "OWNER";
  for (const fn of Object.values(api)) fn.mockReset();
  api.conclusions.mockResolvedValue([conclusion()]);
  api.claimStore.mockResolvedValue({
    claims: [
      { id: "c1", title: "Kalcifikáció: csökken" },
      { id: "c2", title: "Vázsűrűség: csökken" },
    ],
    total: 2,
    layers: {},
  });
  api.modelFlags.mockResolvedValue({ k1: null });
});

describe("ConclusionsPage", () => {
  it("saves a new conclusion only with a text, a reasoning and a claim", async () => {
    api.createConclusion.mockResolvedValue(conclusion({ id: "k2" }));
    render(<ConclusionsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Új következtetés" }),
    );
    const save = screen.getByRole("button", { name: "Tervezet mentése" });
    fireEvent.change(screen.getByLabelText("Következtetés"), {
      target: { value: "Új szöveg" },
    });
    fireEvent.change(screen.getByLabelText("Indoklás és korlátok"), {
      target: { value: "Mert." },
    });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Állítás beszúrása"), {
      target: { value: "c2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hozzáad" }));
    expect(screen.getByText("Vázsűrűség: csökken")).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.createConclusion).toHaveBeenCalledWith("token-1", {
        text: "Új szöveg",
        reasoning: "Mert.",
        claimIds: ["c2"],
      }),
    );
  });

  it("shows the second model's silence as 'nem jelzett', never as checked", async () => {
    api.modelFlags.mockResolvedValue({
      k1: {
        flagged: false,
        source: "gpt-runner",
        runId: "t12-r1",
        model: "gpt-x",
        createdAt: "2026-11-01T10:00:00.000Z",
        current: true,
      },
    });
    render(<ConclusionsPage />);
    fireEvent.click(await screen.findByText(/foszfátigénye/));
    const line = await screen.findByTestId("model-flag");
    expect(api.modelFlags).toHaveBeenCalledWith(
      "token-1",
      "CONCLUSION",
      ["k1"],
      expect.anything(),
    );
    expect(within(line).getByText("nem jelzett")).toBeTruthy();
    expect(line.textContent).toContain("Ez nem ellenőrzés");
    expect(line.textContent).not.toContain("Elavult");
  });

  it("approves a draft with knowledge.approve", async () => {
    api.approveConclusion.mockResolvedValue(conclusion({ status: "APPROVED" }));
    render(<ConclusionsPage />);
    fireEvent.click(await screen.findByText(/foszfátigénye/));
    fireEvent.click(screen.getByRole("button", { name: "Jóváhagyás" }));
    await waitFor(() =>
      expect(api.approveConclusion).toHaveBeenCalledWith("token-1", "k1"),
    );
    expect(await screen.findAllByText("Jóváhagyva")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
  });

  it("withdraws only with a reason, and only after the question that names the citations it breaks", async () => {
    api.conclusions.mockResolvedValue([conclusion({ citationCount: 2 })]);
    api.withdrawConclusion.mockResolvedValue(
      conclusion({ status: "WITHDRAWN", withdrawnReason: "elavult" }),
    );
    render(<ConclusionsPage />);
    fireEvent.click(await screen.findByText(/foszfátigénye/));
    const withdraw = screen.getByRole("button", { name: "Visszavonás" });
    expect(withdraw).toBeDisabled();
    fireEvent.change(screen.getByLabelText("A visszavonás oka"), {
      target: { value: "elavult" },
    });
    fireEvent.click(withdraw);
    expect(api.withdrawConclusion).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "Visszavonod ezt a következtetést?",
    });
    expect(dialog).toHaveTextContent("2 cikk-mondat hivatkozik rá");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Visszavonás" }),
    );
    await waitFor(() =>
      expect(api.withdrawConclusion).toHaveBeenCalledWith(
        "token-1",
        "k1",
        "elavult",
      ),
    );
  });

  it("offers a reader without the editor's rights no write, and says whose the approval is", async () => {
    auth.role = "MANAGER";
    render(<ConclusionsPage />);
    fireEvent.click(await screen.findByText(/foszfátigénye/));
    expect(
      screen.queryByRole("button", { name: "Új következtetés" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Jóváhagyás" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Visszavonás" })).toBeNull();
    expect(
      screen.getByText(/knowledge.approve joggal megy/),
    ).toBeInTheDocument();
  });
});
