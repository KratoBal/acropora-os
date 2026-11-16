import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "./auth-gate";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const auth = vi.hoisted(() => ({
  state: { isLoading: false, session: null as unknown },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./auth-provider", () => ({ useAuth: () => auth.state }));

/*
  WHAT TURNS THIS RED. A signed-out visit to a page sent to the login without the way back (acrobot 50078: the live draw
  opened in OBS landed on the dashboard after signing in), or with the page's query lost.
*/
describe("AuthGate", () => {
  beforeEach(() => {
    router.replace.mockReset();
    auth.state = { isLoading: false, session: null };
  });

  it("sends a signed-out visit to the login with the way back", async () => {
    window.history.pushState({}, "", "/sorsolas?kind=WEEKLY&kerdes=q-1");
    render(<AuthGate>tartalom</AuthGate>);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/login?next=%2Fsorsolas%3Fkind%3DWEEKLY%26kerdes%3Dq-1",
      ),
    );
  });

  it("shows the page when signed in, and sends nowhere", () => {
    auth.state = { isLoading: false, session: { token: "t" } };
    const { getByText } = render(<AuthGate>tartalom</AuthGate>);
    expect(getByText("tartalom")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
