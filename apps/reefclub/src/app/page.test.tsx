import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/lib/session";
import { mockApi, reply } from "@/test/mock-api";

import ReefClubHome from "./page";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => vi.unstubAllGlobals());

const home = () =>
  render(
    <SessionProvider>
      <ReefClubHome />
    </SessionProvider>,
  );

describe("ReefClub start page", () => {
  it("names the app, says it is a test environment, and offers the two ways in when signed out", async () => {
    mockApi({ "GET /me": () => reply(401, { message: "x" }) });
    home();
    expect(
      screen.getByRole("heading", { name: "ReefClub" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Teszt környezet/)).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Belépés" }),
    ).toHaveAttribute("href", "/belepes");
    expect(screen.getByRole("link", { name: "Regisztráció" })).toHaveAttribute(
      "href",
      "/regisztracio",
    );
  });

  it("shows who is signed in, and signing out ends the session and goes to the sign-in page", async () => {
    const { calls } = mockApi({
      "GET /me": () =>
        reply(200, {
          email: "kovacs@example.test",
          loginMethods: ["PASSWORD"],
          notifyOnRelease: true,
          consentVersion: "v1",
        }),
      "POST /auth/logout": () => reply(204),
    });
    const user = userEvent.setup();
    home();
    expect(await screen.findByText("kovacs@example.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Kilépés" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/belepes"),
    );
    expect(
      calls.some((c) => c.method === "POST" && c.path === "/auth/logout"),
    ).toBe(true);
  });

  it("says the service is away when the session cannot be read for another reason than 401", async () => {
    mockApi({ "GET /me": () => reply(502, {}) });
    home();
    expect(await screen.findByRole("alert")).toHaveTextContent("nem érhető el");
  });
});
