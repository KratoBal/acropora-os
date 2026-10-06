import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Session,
  type UserPermissionOverview,
  type UserRole,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserPermissionTable } from "./user-permission-table";

/**
 * A FELHASZNÁLÓNKÉNTI JOGOK TÁBLÁZATA (3. lépés).
 *
 * MI PIROSÍT: ha a mentés nem a sablonhoz mért eltéréseket küldi; ha az
 * eltérő sor nem látszik eltérőnek; ha egy nem tulajdonos csak-tulajdonosi
 * jogot menthetne; ha a gépi fiók szerkeszthető lenne.
 */
const api = vi.hoisted(() => ({
  permissions: vi.fn(),
  replacePermissions: vi.fn(),
}));
vi.mock("@/lib/api/users", () => ({ usersApi: api }));

const auth = vi.hoisted(() => ({ role: "OWNER" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "actor",
        email: "a@acropora.local",
        displayName: "A",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

function overview(
  role: UserRole,
  overrides: UserPermissionOverview["overrides"] = [],
): UserPermissionOverview {
  const template = [...ROLE_PERMISSIONS[role]];
  const effective = new Set(template);
  for (const o of overrides)
    if (o.effect === "GRANT") effective.add(o.permission);
    else effective.delete(o.permission);
  return {
    userId: "u1",
    role,
    template,
    overrides,
    effective: [...effective],
    ownerGranted: [],
  };
}

function row(key: string) {
  return screen.getByTestId(`terulet-${key}`);
}

beforeEach(() => {
  auth.role = "OWNER";
  api.permissions.mockResolvedValue(overview("SERVICE"));
  api.replacePermissions.mockImplementation(
    async (
      _t: string,
      _id: string,
      overrides: UserPermissionOverview["overrides"],
    ) => overview("SERVICE", overrides),
  );
});
afterEach(() => vi.clearAllMocks());

const mount = () =>
  render(
    <UserPermissionTable userId="u1" customerId={null} supplierId={null} />,
  );

describe("UserPermissionTable", () => {
  it("a sablon szintjei, eltérés nélkül nincs kiemelés és nincs mentés", async () => {
    mount();
    expect(await screen.findByText("Jogosultságok")).toBeTruthy();
    const service = row("service");
    expect(
      within(service)
        .getByRole("radio", { name: "Kezelés" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByText("egyéni")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Jogosultságok mentése",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("a meglévő eltérés kiemelve áll", async () => {
    api.permissions.mockResolvedValue(
      overview("SERVICE", [
        { permission: PERMISSIONS.SERVICE_MANAGE, effect: "REVOKE" },
      ]),
    );
    mount();
    await screen.findByText("Jogosultságok");
    expect(within(row("service")).getByText("egyéni")).toBeTruthy();
    expect(
      within(row("service"))
        .getByRole("radio", { name: "Megtekintés" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a mentés a sablonhoz mért eltéréseket küldi", async () => {
    mount();
    await screen.findByText("Jogosultságok");
    fireEvent.click(
      within(row("finance")).getByRole("radio", { name: "Megtekintés" }),
    );
    fireEvent.click(
      within(row("service")).getByRole("radio", { name: "Megtekintés" }),
    );
    expect(within(row("finance")).getByText("egyéni")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Jogosultságok mentése" }),
    );
    await waitFor(() => expect(api.replacePermissions).toHaveBeenCalled());
    const sent = api.replacePermissions.mock
      .calls[0]![2] as UserPermissionOverview["overrides"];
    expect(sent).toContainEqual({
      permission: PERMISSIONS.FINANCE_VIEW,
      effect: "GRANT",
    });
    expect(sent).toContainEqual({
      permission: PERMISSIONS.SERVICE_MANAGE,
      effect: "REVOKE",
    });
    expect(sent).not.toContainEqual(
      expect.objectContaining({ permission: PERMISSIONS.SERVICE_VIEW }),
    );
    expect(await screen.findByText("A jogosultságok elmentve.")).toBeTruthy();
  });

  it("nem tulajdonos csak-tulajdonosi jogot nem menthet", async () => {
    auth.role = "ADMIN";
    mount();
    await screen.findByText("Jogosultságok");
    fireEvent.click(
      within(row("users")).getByRole("radio", { name: "Kezelés" }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /csak tulajdonos/,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Jogosultságok mentése",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("nem tulajdonos a saját fiókjának nem ad jogot, de elvehet magától", async () => {
    auth.role = "ADMIN";
    // a bejelentkezett felhasználó azonosítója "actor": a saját adatlapja
    render(
      <UserPermissionTable
        userId="actor"
        customerId={null}
        supplierId={null}
      />,
    );
    await screen.findByText("Jogosultságok");
    const mentes = () =>
      screen.getByRole("button", {
        name: "Jogosultságok mentése",
      }) as HTMLButtonElement;

    fireEvent.click(
      within(row("service")).getByRole("radio", { name: "Nincs" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mentes().disabled).toBe(false);

    fireEvent.click(
      within(row("finance")).getByRole("radio", { name: "Megtekintés" }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /saját fiókodnak/,
    );
    expect(mentes().disabled).toBe(true);
  });

  it("vissza a sablonra: üres eltérés-listát ment", async () => {
    api.permissions.mockResolvedValue(
      overview("SERVICE", [
        { permission: PERMISSIONS.FINANCE_VIEW, effect: "GRANT" },
      ]),
    );
    mount();
    await screen.findByText("Jogosultságok");
    fireEvent.click(screen.getByRole("button", { name: "Vissza a sablonra" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Jogosultságok mentése" }),
    );
    await waitFor(() => expect(api.replacePermissions).toHaveBeenCalled());
    expect(api.replacePermissions.mock.calls[0]![2]).toEqual([]);
  });

  it("gépi fiók: csak olvasható, mentés nincs", async () => {
    api.permissions.mockResolvedValue(overview("CONTENT_AGENT"));
    mount();
    expect(await screen.findByText(/Gépi fiók/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Jogosultságok mentése" }),
    ).toBeNull();
    expect(
      (within(row("content")).getAllByRole("radio")[0] as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
