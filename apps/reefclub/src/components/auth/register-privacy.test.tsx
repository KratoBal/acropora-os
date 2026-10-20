import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PRIVACY_NOTICE_VERSION } from "@/lib/consent";
import { SessionProvider } from "@/lib/session";
import { mockApi, reply } from "@/test/mock-api";

import { RegisterForm } from "./register-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

/**
 * THE PAGE SHOWS THE TEXT OF THE VERSION THE SERVER EXPECTS (card 33780bcb).
 * What must fail: a registration collected for a text version the server will
 * not accept; a page blocked because the version route could not be read (the
 * server's own check is the authority then).
 */
async function fillAndTick(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("E-mail cím"), "uj@example.test");
  await user.type(
    screen.getByLabelText("Jelszó", { exact: true }),
    "hosszu-jelszo-1",
  );
  await user.type(
    screen.getByLabelText("Jelszó még egyszer"),
    "hosszu-jelszo-1",
  );
  await user.click(screen.getByRole("checkbox"));
}

function page() {
  render(
    <SessionProvider>
      <RegisterForm />
    </SessionProvider>,
  );
}

describe("RegisterForm and the server's privacy-notice version", () => {
  it("the same version: the registration goes, carrying it", async () => {
    const { calls } = mockApi({
      "GET /me": () => reply(401, {}),
      "GET /auth/privacy-consent": () =>
        reply(200, { version: PRIVACY_NOTICE_VERSION }),
      "POST /auth/register": () => reply(202),
    });
    const user = userEvent.setup();
    page();
    await fillAndTick(user);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Regisztráció" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Regisztráció" }));
    expect(
      await screen.findByText("Nézd meg a postaládádat"),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/auth/register")!.body).toMatchObject({
      consentVersion: PRIVACY_NOTICE_VERSION,
    });
  });

  it("another version on the server: the page says the text is being updated and does not register", async () => {
    const { calls } = mockApi({
      "GET /me": () => reply(401, {}),
      "GET /auth/privacy-consent": () =>
        reply(200, { version: "adatkezeles-2999-01-01" }),
    });
    const user = userEvent.setup();
    page();
    await fillAndTick(user);
    expect(
      await screen.findByText(
        "Az adatkezelési tájékoztató szövege frissítés alatt",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regisztráció" })).toBeDisabled();
    expect(calls.some((c) => c.path === "/auth/register")).toBe(false);
  });

  it("the version route cannot be read: the page is not blocked, the server's check decides", async () => {
    mockApi({
      "GET /me": () => reply(401, {}),
      "GET /auth/privacy-consent": () => reply(502, {}),
      "POST /auth/register": () =>
        reply(400, {
          message:
            "Az adatkezelési tájékoztató szövege időközben megváltozott.",
        }),
    });
    const user = userEvent.setup();
    page();
    await fillAndTick(user);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Regisztráció" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Regisztráció" }));
    expect(
      await screen.findByText(
        "Az adatkezelési tájékoztató szövege időközben megváltozott.",
      ),
    ).toBeInTheDocument();
  });
});
