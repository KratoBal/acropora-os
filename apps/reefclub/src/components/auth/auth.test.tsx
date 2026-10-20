import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/lib/session";
import { mockApi, reply } from "@/test/mock-api";

import { LoginForm } from "./login-form";
import { PasswordReset } from "./password-reset";
import { RegisterForm } from "./register-form";
import { VerifyEmail } from "./verify-email";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));

const ME = {
  email: "kovacs@example.test",
  loginMethods: ["PASSWORD"],
  notifyOnRelease: true,
  consentVersion: "v1",
};

function inSession(node: React.ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

beforeEach(() => {
  router.replace.mockReset();
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

describe("LoginForm", () => {
  it("signs in, reads the session, and goes to the start page", async () => {
    let signedIn = false;
    const { calls } = mockApi({
      "GET /me": () =>
        signedIn ? reply(200, ME) : reply(401, { message: "x" }),
      "POST /auth/login": () => {
        signedIn = true;
        return reply(204);
      },
    });
    const user = userEvent.setup();
    inSession(<LoginForm />);

    await user.type(
      screen.getByLabelText("E-mail cím"),
      "  kovacs@example.test ",
    );
    await user.type(screen.getByLabelText("Jelszó"), "titkos-jelszo");
    await user.click(screen.getByRole("button", { name: "Belépés" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    const login = calls.find((c) => c.path === "/auth/login")!;
    expect(login.body).toEqual({
      email: "kovacs@example.test",
      password: "titkos-jelszo",
    });
    // the session is read again after the sign-in, before the page changes
    expect(calls.filter((c) => c.path === "/me").length).toBe(2);
  });

  it("shows the server's words when the sign-in fails, and does not navigate", async () => {
    mockApi({
      "GET /me": () => reply(401, { message: "x" }),
      "POST /auth/login": () =>
        reply(401, { message: "Hibás e-mail cím vagy jelszó." }),
    });
    const user = userEvent.setup();
    inSession(<LoginForm />);
    await user.type(screen.getByLabelText("E-mail cím"), "a@b.hu");
    await user.type(screen.getByLabelText("Jelszó"), "rossz");
    await user.click(screen.getByRole("button", { name: "Belépés" }));

    expect(
      await screen.findByText("Hibás e-mail cím vagy jelszó."),
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("keeps the button off until both fields are filled", () => {
    mockApi({ "GET /me": () => reply(401, {}) });
    inSession(<LoginForm />);
    expect(screen.getByRole("button", { name: "Belépés" })).toBeDisabled();
  });
});

describe("RegisterForm", () => {
  async function fill(
    user: ReturnType<typeof userEvent.setup>,
    password = "hosszu-jelszo-1",
    again = password,
  ) {
    await user.type(screen.getByLabelText("E-mail cím"), "uj@example.test");
    await user.type(screen.getByLabelText("Jelszó", { exact: true }), password);
    await user.type(screen.getByLabelText("Jelszó még egyszer"), again);
  }

  it("needs the notice accepted: without it the button stays off", async () => {
    mockApi({ "GET /me": () => reply(401, {}) });
    const user = userEvent.setup();
    inSession(<RegisterForm />);
    await fill(user);
    expect(screen.getByRole("button", { name: "Regisztráció" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Regisztráció" })).toBeEnabled();
  });

  it("names a short password and a mismatch before anything is sent", async () => {
    const { calls } = mockApi({ "GET /me": () => reply(401, {}) });
    const user = userEvent.setup();
    inSession(<RegisterForm />);
    await fill(user, "rovid", "rovid");
    expect(screen.getByText("Legalább 10 karakter.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Jelszó", { exact: true }));
    await user.type(
      screen.getByLabelText("Jelszó", { exact: true }),
      "hosszu-jelszo-1",
    );
    expect(screen.getByText("A két jelszó nem egyezik.")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/auth/register")).toBe(false);
  });

  it("sends the notice version with the registration and answers the same whatever the address", async () => {
    const { calls } = mockApi({
      "GET /me": () => reply(401, {}),
      "POST /auth/register": () => reply(202),
    });
    const user = userEvent.setup();
    inSession(<RegisterForm />);
    await fill(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Regisztráció" }));

    expect(
      await screen.findByText("Nézd meg a postaládádat"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ha ehhez az e-mail címhez még nincs fiók/),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/auth/register")!.body).toEqual({
      email: "uj@example.test",
      password: "hosszu-jelszo-1",
      consentVersion: "adatkezeles-tervezet-2026-10-20",
    });
  });

  it("says the notice is a draft", () => {
    mockApi({ "GET /me": () => reply(401, {}) });
    inSession(<RegisterForm />);
    expect(screen.getByText(/nem a végleges jogi szöveg/)).toBeInTheDocument();
  });
});

describe("VerifyEmail", () => {
  it("sends the token from the fragment, removes it from the address, and says it worked", async () => {
    window.history.replaceState(null, "", "/email-megerosites#token=abc123");
    const { calls } = mockApi({ "POST /auth/verify-email": () => reply(204) });
    render(<VerifyEmail />);

    expect(
      await screen.findByText("Az e-mail címed megerősítve"),
    ).toBeInTheDocument();
    expect(calls[0]!.body).toEqual({ token: "abc123" });
    expect(window.location.hash).toBe("");
  });

  it("shows the server's words for a used or expired link", async () => {
    window.history.replaceState(null, "", "/email-megerosites#token=old");
    mockApi({
      "POST /auth/verify-email": () =>
        reply(400, { message: "A link érvénytelen vagy lejárt." }),
    });
    render(<VerifyEmail />);
    expect(
      await screen.findByText("A link érvénytelen vagy lejárt."),
    ).toBeInTheDocument();
  });

  it("says so, and calls nothing, when the link has no token", async () => {
    const { calls } = mockApi({});
    render(<VerifyEmail />);
    expect(
      await screen.findByText(/nincs benne megerősítő kód/),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });
});

describe("PasswordReset", () => {
  it("without a token it asks for the address and answers the same for any address", async () => {
    const { calls } = mockApi({
      "POST /auth/password-reset": () => reply(202),
    });
    const user = userEvent.setup();
    render(<PasswordReset />);
    await user.type(
      await screen.findByLabelText("E-mail cím"),
      "valaki@example.test",
    );
    await user.click(screen.getByRole("button", { name: "Új jelszó kérése" }));
    expect(
      await screen.findByText(/Ha ehhez az e-mail címhez tartozik fiók/),
    ).toBeInTheDocument();
    expect(calls[0]!.body).toEqual({ email: "valaki@example.test" });
  });

  it("with a token in the fragment it sets the new password and says every session ended", async () => {
    window.history.replaceState(null, "", "/jelszo-visszaallitas#token=tok9");
    const { calls } = mockApi({
      "POST /auth/password-reset/confirm": () => reply(204),
    });
    const user = userEvent.setup();
    render(<PasswordReset />);
    await user.type(
      await screen.findByLabelText("Új jelszó", { exact: true }),
      "uj-hosszu-jelszo",
    );
    await user.type(
      screen.getByLabelText("Új jelszó még egyszer"),
      "uj-hosszu-jelszo",
    );
    await user.click(
      screen.getByRole("button", { name: "Új jelszó beállítása" }),
    );

    expect(
      await screen.findByText("Az új jelszó beállítva"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Minden korábbi munkamenet kilépett/),
    ).toBeInTheDocument();
    expect(calls[0]!.body).toEqual({
      token: "tok9",
      password: "uj-hosszu-jelszo",
    });
    expect(window.location.hash).toBe("");
  });

  it("keeps the new-password button off for a short or mismatching password", async () => {
    window.history.replaceState(null, "", "/jelszo-visszaallitas#token=tok9");
    mockApi({});
    const user = userEvent.setup();
    render(<PasswordReset />);
    await user.type(
      await screen.findByLabelText("Új jelszó", { exact: true }),
      "rovid",
    );
    expect(
      screen.getByRole("button", { name: "Új jelszó beállítása" }),
    ).toBeDisabled();
  });
});
