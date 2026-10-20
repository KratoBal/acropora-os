import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Account } from "@/components/account";
import { SHARE_CONSENT_VERSION } from "@/lib/consent";
import { SessionProvider } from "@/lib/session";
import { mockApi, reply } from "@/test/mock-api";

import { SharePanel } from "./share-panel";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.replace.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const AQUARIUM = {
  id: "a1",
  origin: "OWN" as const,
  name: "Nappali nano",
  waterBodyType: "AKVARIUM" as const,
  waterType: "TENGERI" as const,
  systemVolumeLiters: 120,
  sharedWithShopAt: null as string | null,
  createdAt: "2026-10-01T09:00:00.000Z",
};
const PREVIEW = {
  aquarium: {
    name: "Nappali nano",
    waterBodyType: "AKVARIUM",
    waterType: "TENGERI",
    systemVolumeLiters: 120,
  },
  targets: [{ parameterCode: "PH", min: 8, max: 8.4 }],
  occasions: [
    {
      measuredAt: "2026-10-03T10:00:00.000Z",
      values: [{ parameterCode: "PH", value: 8.3 }],
    },
  ],
};

describe("SharePanel", () => {
  it("shows what the shop would see before anything is shared, and shares only after the consent is ticked", async () => {
    const { calls } = mockApi({
      "GET /aquariums/a1/share/preview": () => reply(200, PREVIEW),
      "GET /me/share-consent": () =>
        reply(200, { version: SHARE_CONSENT_VERSION }),
      "POST /aquariums/a1/share": () =>
        reply(200, {
          ...AQUARIUM,
          sharedWithShopAt: "2026-10-20T10:00:00.000Z",
        }),
    });
    const onChanged = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<SharePanel aquarium={AQUARIUM} onChanged={onChanged} />);

    expect(await screen.findByText("Ezt látná a bolt")).toBeInTheDocument();
    expect(screen.getByText(/1 célsáv, 1 mérési alkalom/)).toBeInTheDocument();
    expect(screen.getByText(/pH 8,3/)).toBeInTheDocument();
    expect(screen.getByText(/Ez az akvárium privát/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Megosztás a bolttal" }),
    );
    expect(screen.getByText(/nem a végleges jogi szöveg/)).toBeInTheDocument();
    const share = screen.getByRole("button", { name: "Megosztom" });
    expect(share).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(share).toBeEnabled());
    await user.click(share);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      consentVersion: SHARE_CONSENT_VERSION,
    });
  });

  it("does not share when the server expects another text version than the page shows", async () => {
    const { calls } = mockApi({
      "GET /aquariums/a1/share/preview": () => reply(200, PREVIEW),
      "GET /me/share-consent": () =>
        reply(200, { version: "megosztas-2999-01-01" }),
    });
    const user = userEvent.setup();
    render(<SharePanel aquarium={AQUARIUM} onChanged={async () => {}} />);
    await user.click(
      await screen.findByRole("button", { name: "Megosztás a bolttal" }),
    );
    expect(
      await screen.findByText("A megosztás szövege frissítés alatt"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Megosztom" })).toBeDisabled();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shared: says since when and what the shop sees now, and revoking asks nothing more and reloads", async () => {
    const { calls } = mockApi({
      "GET /aquariums/a1/share/preview": () => reply(200, PREVIEW),
      "GET /me/share-consent": () =>
        reply(200, { version: SHARE_CONSENT_VERSION }),
      "DELETE /aquariums/a1/share": () => reply(204),
    });
    const onChanged = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <SharePanel
        aquarium={{ ...AQUARIUM, sharedWithShopAt: "2026-10-18T09:00:00.000Z" }}
        onChanged={onChanged}
      />,
    );
    expect(
      await screen.findByText("Ezt látja most a bolt"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Megosztva .* óta/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Megosztás a bolttal" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Megosztás visszavonása" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(
      calls.some(
        (c) => c.method === "DELETE" && c.path === "/aquariums/a1/share",
      ),
    ).toBe(true);
  });

  it("shows the server's words when sharing fails", async () => {
    mockApi({
      "GET /aquariums/a1/share/preview": () => reply(200, PREVIEW),
      "GET /me/share-consent": () =>
        reply(200, { version: SHARE_CONSENT_VERSION }),
      "POST /aquariums/a1/share": () =>
        reply(400, { message: "A megosztás most nem lehetséges." }),
    });
    const user = userEvent.setup();
    render(<SharePanel aquarium={AQUARIUM} onChanged={async () => {}} />);
    await user.click(
      await screen.findByRole("button", { name: "Megosztás a bolttal" }),
    );
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Megosztom" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Megosztom" }));
    expect(
      await screen.findByText("A megosztás most nem lehetséges."),
    ).toBeInTheDocument();
  });
});

const ME = {
  email: "kovacs@example.test",
  loginMethods: ["PASSWORD"],
  notifyOnRelease: true,
  consentVersion: "v1",
};

function account() {
  return render(
    <SessionProvider>
      <Account />
    </SessionProvider>,
  );
}

describe("Account", () => {
  it("shows the address and how the user signs in, and saves the release e-mail switch", async () => {
    let notify = true;
    const { calls } = mockApi({
      "GET /me": () => reply(200, { ...ME, notifyOnRelease: notify }),
      "PATCH /me": (call) => {
        notify = (call.body as { notifyOnRelease: boolean }).notifyOnRelease;
        return reply(200, { ...ME, notifyOnRelease: notify });
      },
    });
    const user = userEvent.setup();
    account();
    expect(await screen.findByText("kovacs@example.test")).toBeInTheDocument();
    expect(screen.getByText("jelszó")).toBeInTheDocument();

    const box = screen.getByRole("checkbox", { name: /E-mailt kérek/ });
    expect(box).toBeChecked();
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({
      notifyOnRelease: false,
    });
  });

  it("deletes the account only after a second step with the password, then leaves for the sign-in page", async () => {
    let gone = false;
    const { calls } = mockApi({
      "GET /me": () => (gone ? reply(401, { message: "x" }) : reply(200, ME)),
      "DELETE /me": () => {
        gone = true;
        return reply(202);
      },
    });
    const user = userEvent.setup();
    account();
    await user.click(
      await screen.findByRole("button", { name: "Fiók törlése" }),
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(
      screen.getByRole("button", { name: /Igen, kérem a fiókom törlését/ }),
    ).toBeDisabled();
    await user.type(
      screen.getByLabelText("A jelszavad a megerősítéshez"),
      "titkos-jelszo",
    );
    await user.click(
      screen.getByRole("button", { name: /Igen, kérem a fiókom törlését/ }),
    );

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/belepes"),
    );
    expect(calls.find((c) => c.method === "DELETE")!.body).toEqual({
      method: "PASSWORD",
      password: "titkos-jelszo",
    });
  });

  it("keeps the account and shows the server's words when the password is wrong", async () => {
    mockApi({
      "GET /me": () => reply(200, ME),
      "DELETE /me": () => reply(401, { message: "Hibás jelszó." }),
    });
    const user = userEvent.setup();
    account();
    await user.click(
      await screen.findByRole("button", { name: "Fiók törlése" }),
    );
    await user.type(
      screen.getByLabelText("A jelszavad a megerősítéshez"),
      "rossz",
    );
    await user.click(
      screen.getByRole("button", { name: /Igen, kérem a fiókom törlését/ }),
    );
    expect(await screen.findByText("Hibás jelszó.")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("says it cannot delete an account that has only a Google or Apple sign-in, instead of showing a form that cannot work", async () => {
    mockApi({
      "GET /me": () => reply(200, { ...ME, loginMethods: ["GOOGLE"] }),
    });
    account();
    const section = (
      await screen.findByRole("heading", { name: "Fiók törlése" })
    ).closest("section")!;
    expect(within(section).getByText(/külső belépéssel/)).toBeInTheDocument();
    expect(
      within(section).queryByRole("button", { name: "Fiók törlése" }),
    ).toBeNull();
  });
});
