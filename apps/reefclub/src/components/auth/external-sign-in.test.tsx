import { createHash } from "node:crypto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APPLE_SCRIPT, GOOGLE_SCRIPT } from "@/lib/external-scripts";
import { PRIVACY_NOTICE_VERSION } from "@/lib/consent";
import type { PublicConfig } from "@/lib/public-config";
import { SessionProvider } from "@/lib/session";
import { mockApi, reply } from "@/test/mock-api";

import { ExternalSignIn } from "./external-sign-in";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const ME = {
  email: "kovacs@example.test",
  loginMethods: ["GOOGLE"],
  notifyOnRelease: true,
  consentVersion: "v1",
};
const BOTH: PublicConfig = {
  googleClientId: "google-client.example",
  appleClientId: "hu.example.web",
  appleRedirectUri: "https://rc.example.test",
};
const OFF: PublicConfig = {
  googleClientId: null,
  appleClientId: null,
  appleRedirectUri: null,
};

let googleCallback: ((response: { credential?: string }) => void) | undefined;
const google = {
  accounts: {
    id: {
      initialize: vi.fn(
        (options: { callback(response: { credential?: string }): void }) => {
          googleCallback = options.callback;
        },
      ),
      renderButton: vi.fn(),
    },
  },
};
const appleInit = vi.fn();
const appleSignIn = vi.fn();

beforeEach(() => {
  router.replace.mockReset();
  googleCallback = undefined;
  google.accounts.id.initialize.mockClear();
  google.accounts.id.renderButton.mockClear();
  appleInit.mockReset();
  appleSignIn.mockReset();
  window.google = google;
  window.AppleID = { auth: { init: appleInit, signIn: appleSignIn } };
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.google;
  delete window.AppleID;
});

function view(config: PublicConfig, loadScript = vi.fn(async () => {})) {
  render(
    <SessionProvider>
      <ExternalSignIn loadScript={loadScript} loadConfig={async () => config} />
    </SessionProvider>,
  );
  return loadScript;
}

describe("ExternalSignIn", () => {
  it("shows nothing and loads no provider script when no client id is set", async () => {
    mockApi({ "GET /me": () => reply(401, {}) });
    const loadScript = view(OFF);
    await waitFor(() => expect(loadScript).not.toHaveBeenCalled());
    expect(
      screen.queryByRole("region", { name: "Belépés külső fiókkal" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Apple/ })).toBeNull();
  });

  it("loads only the script of the method that is switched on", async () => {
    mockApi({ "GET /me": () => reply(401, {}) });
    const loadScript = view({
      ...OFF,
      googleClientId: "google-client.example",
    });
    await waitFor(() =>
      expect(google.accounts.id.renderButton).toHaveBeenCalled(),
    );
    expect(loadScript).toHaveBeenCalledWith(GOOGLE_SCRIPT);
    expect(loadScript).not.toHaveBeenCalledWith(APPLE_SCRIPT);
    expect(screen.queryByRole("button", { name: /Apple/ })).toBeNull();
  });

  it("Google: gives the provider's credential to the server, with the notice version only if the box is ticked, and goes in", async () => {
    let signedIn = false;
    const { calls } = mockApi({
      "GET /me": () => (signedIn ? reply(200, ME) : reply(401, {})),
      "POST /auth/google": () => {
        signedIn = true;
        return reply(204);
      },
    });
    const user = userEvent.setup();
    view(BOTH);
    await waitFor(() => expect(googleCallback).toBeDefined());
    expect(google.accounts.id.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "google-client.example" }),
    );

    // not ticked: a returning user is not asked for the notice
    googleCallback!({ credential: "id-token-1" });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(calls.find((c) => c.path === "/auth/google")!.body).toEqual({
      idToken: "id-token-1",
    });

    // ticked: the version goes with it (the callback reads the box at the moment it fires)
    router.replace.mockReset();
    await user.click(screen.getByRole("checkbox"));
    googleCallback!({ credential: "id-token-2" });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    const second = calls.filter((c) => c.path === "/auth/google")[1]!;
    expect(second.body).toEqual({
      idToken: "id-token-2",
      consentVersion: PRIVACY_NOTICE_VERSION,
    });
  });

  it("shows the server's words when a new account needs the notice, and does not go in", async () => {
    mockApi({
      "GET /me": () => reply(401, {}),
      "POST /auth/google": () =>
        reply(422, {
          message:
            "Az első belépéshez el kell fogadni az adatkezelési tájékoztatót.",
        }),
    });
    view(BOTH);
    await waitFor(() => expect(googleCallback).toBeDefined());
    googleCallback!({ credential: "id-token" });
    expect(
      await screen.findByText(
        "Az első belépéshez el kell fogadni az adatkezelési tájékoztatót.",
      ),
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("Apple: gives Apple the SHA-256 of a raw nonce and the server the raw one", async () => {
    let signedIn = false;
    const { calls } = mockApi({
      "GET /me": () => (signedIn ? reply(200, ME) : reply(401, {})),
      "POST /auth/apple": () => {
        signedIn = true;
        return reply(204);
      },
    });
    appleSignIn.mockResolvedValue({
      authorization: { id_token: "apple-token" },
    });
    const user = userEvent.setup();
    view(BOTH);
    await user.click(
      await screen.findByRole("button", { name: "Belépés Apple-fiókkal" }),
    );

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    const init = appleInit.mock.calls[0]![0] as {
      clientId: string;
      nonce: string;
      redirectURI: string;
      usePopup: boolean;
      scope: string;
    };
    expect(init).toMatchObject({
      clientId: "hu.example.web",
      redirectURI: "https://rc.example.test",
      usePopup: true,
      scope: "email",
    });
    const body = calls.find((c) => c.path === "/auth/apple")!.body as {
      idToken: string;
      nonce: string;
    };
    expect(body.idToken).toBe("apple-token");
    expect(init.nonce).toBe(
      createHash("sha256").update(body.nonce).digest("hex"),
    );
    expect(init.nonce).not.toBe(body.nonce);
  });

  it("Apple: a closed popup is a choice, not an error; another failure is shown", async () => {
    mockApi({ "GET /me": () => reply(401, {}) });
    const user = userEvent.setup();
    view(BOTH);
    const button = await screen.findByRole("button", {
      name: "Belépés Apple-fiókkal",
    });
    appleSignIn.mockRejectedValueOnce({ error: "popup_closed_by_user" });
    await user.click(button);
    await waitFor(() => expect(appleSignIn).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();

    appleSignIn.mockRejectedValueOnce(new Error("Az Apple nem válaszolt."));
    await user.click(button);
    expect(
      await screen.findByText("Az Apple nem válaszolt."),
    ).toBeInTheDocument();
  });

  it("says so when the provider's script cannot be loaded", async () => {
    mockApi({ "GET /me": () => reply(401, {}) });
    view(
      { ...OFF, googleClientId: "google-client.example" },
      vi.fn(async () => {
        throw new Error("A szkript nem töltődött be: accounts.google.com");
      }),
    );
    expect(
      await screen.findByText(
        "A szkript nem töltődött be: accounts.google.com",
      ),
    ).toBeInTheDocument();
  });
});
