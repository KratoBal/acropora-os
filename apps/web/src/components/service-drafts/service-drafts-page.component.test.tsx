import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceDraftListResponse, Session } from "@acropora/types";
import { ServiceDraftsPage } from "./service-drafts-page";
vi.mock("next/font/local", () => ({ default: () => ({ className: "inter" }) }));
const mock = vi.hoisted(() => ({
  list: vi.fn(),
  status: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  attachment: vi.fn(),
  push: vi.fn(),
  session: null as Session | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: mock.session }),
}));
vi.mock("@/lib/api/service-drafts", () => ({ serviceDraftsApi: mock }));
function data(): ServiceDraftListResponse {
  return {
    items: [
      {
        id: "draft",
        title: "Venturi szivattyú",
        originalProblem: "Szivattyú tisztítás\nÉs a csövek javítása.",
        reportDate: "2026-10-03",
        createdAt: "2026-10-04T12:00:00Z",
        status: "PENDING",
        proposedDepartmentId: "dep",
        decidedById: null,
        decidedAt: null,
        acceptedServiceJobId: null,
        mail: {
          originalText: "Dolgozók: [NEV]\nTeljes napi jelentő",
          subject: "Napi jelentő",
          mailbox: "balazs@acropora.hu",
        },
        attachments: [],
        occurrence: 2,
        earlier: [
          {
            id: "earlier",
            reportDate: "2026-09-26",
            status: "ACCEPTED",
            acceptedServiceJobId: "old-job",
          },
        ],
      },
    ],
    nextCursor: null,
    locations: [
      { id: "dep", parentId: null, name: "Cápasuli", customerId: "zoo" },
    ],
    openedBy: { id: "opener", name: "Cápasuli" },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.session = {
    id: "session",
    expiresAt: "2099-01-01",
    token: "token",
    user: {
      id: "admin",
      email: "admin@example.test",
      displayName: "Admin",
      role: "ADMIN",
      customerId: null,
      supplierId: null,
    },
  };
  mock.list.mockResolvedValue(data());
  mock.status.mockResolvedValue({
    enabled: false,
    switchReason: "NOT_SET",
    configured: false,
    mailbox: "balazs@acropora.hu",
    query: "napi jelentő",
    intervalMinutes: 60,
    lastRunAt: null,
    lastError: null,
  });
  mock.accept.mockResolvedValue({ serviceJobId: "job" });
  mock.reject.mockResolvedValue({ serviceJobId: null });
});
describe("Service draft review", () => {
  it("lets the reviewer correct the From display name before accepting", async () => {
    const response = data();
    response.items[0]!.reporterPersonName = "Szilveszter Roland";
    mock.list.mockResolvedValue(response);
    render(<ServiceDraftsPage />);
    const input = await screen.findByLabelText("Jelentő szerzője");
    expect((input as HTMLInputElement).value).toBe("Szilveszter Roland");
    fireEvent.change(input, { target: { value: "Kovács Anna" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Elfogadom: Venturi szivattyú" }),
    );
    await waitFor(() =>
      expect(mock.accept).toHaveBeenCalledWith(
        "token",
        "draft",
        "dep",
        "Kovács Anna",
      ),
    );
  });
  it("shows verbatim text, complete report, repeated occurrence and chosen opener", async () => {
    render(<ServiceDraftsPage />);
    await screen.findByText("Venturi szivattyú");
    expect(screen.getByText(/És a csövek javítása/)).toBeTruthy();
    expect(screen.getByText(/2. alkalom/)).toBeTruthy();
    expect(screen.getByText(/A hibajegy nyitója/)).toBeTruthy();
    fireEvent.click(screen.getByText("Teljes napi jelentő megnyitása"));
    expect(screen.getByText(/Dolgozók/)).toBeTruthy();
  });
  it("accepts selected location once and navigates to the existing ticket detail", async () => {
    render(<ServiceDraftsPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Elfogadom: Venturi szivattyú",
      }),
    );
    await waitFor(() =>
      expect(mock.push).toHaveBeenCalledWith("/szerviz/hibajegyek/job"),
    );
    expect(mock.accept).toHaveBeenCalledWith("token", "draft", "dep", "");
    expect(mock.reject).not.toHaveBeenCalled();
  });
  it("records reject without creating or navigating to a ticket", async () => {
    render(<ServiceDraftsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Elvetem: Venturi szivattyú" }),
    );
    await screen.findByText("A piszkozatot elvetetted.");
    expect(mock.reject).toHaveBeenCalledWith("token", "draft");
    expect(mock.accept).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("disables accept when the Capasuli user is missing, leaving reject available", async () => {
    mock.list.mockResolvedValue({ ...data(), openedBy: null });
    render(<ServiceDraftsPage />);
    expect(
      (
        (await screen.findByRole("button", {
          name: "Elfogadom: Venturi szivattyú",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Elvetem: Venturi szivattyú",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("keeps failed decision visible and allows retry", async () => {
    mock.accept.mockRejectedValue(new Error("Nem menthető"));
    render(<ServiceDraftsPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Elfogadom: Venturi szivattyú",
      }),
    );
    await screen.findByText("Nem menthető");
    expect(mock.push).not.toHaveBeenCalled();
  });
  it("does not fetch reports for managers or partner accounts", () => {
    mock.session!.user.role = "MANAGER";
    render(<ServiceDraftsPage />);
    expect(screen.getByText(/csak belső adminisztrátoroknak/)).toBeTruthy();
    expect(mock.list).not.toHaveBeenCalled();
  });
  it("shows empty results and rejected history via separate tabs", async () => {
    mock.list.mockResolvedValue({ ...data(), items: [] });
    render(<ServiceDraftsPage />);
    await screen.findByText("Nincs ilyen állapotú piszkozat.");
    fireEvent.click(screen.getByRole("tab", { name: "Elvetett" }));
    await waitFor(() =>
      expect(mock.list).toHaveBeenLastCalledWith(
        "token",
        "REJECTED",
        undefined,
        expect.any(AbortSignal),
      ),
    );
  });
});
