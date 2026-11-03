import { render, screen, waitFor } from "@testing-library/react";
import {
  PERMISSION_AREAS,
  ROLE_PERMISSIONS,
  type Session,
  type UserPermissionOverview,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserPermissionTable } from "./user-permission-table";

/*
  A JOGOSULTSÁG-TÁBLA TELEFONON (UI-áttekintés, 3. csomag, 2026-11-03). A happy-dom nem számol CSS-t,
  ezért az állítások az elemek osztályaira és attribútumaira szólnak; a tényleges megjelenést a
  stage-fotó méri (390 és 1440 px). MI PIROSÍT: ha a tábla telefonon nem vált blokk-elrendezésre, ha a
  fejléc nem marad meg a képernyőolvasónak, ha egy sor elveszti a telefonos elrendezést, vagy ha egy
  "Sablon" cella `data-label` nélkül marad (a felirat onnan jön).
*/
const api = vi.hoisted(() => ({
  permissions: vi.fn(),
  replacePermissions: vi.fn(),
}));
vi.mock("@/lib/api/users", () => ({ usersApi: api }));
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
        role: "OWNER",
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

function overview(): UserPermissionOverview {
  const template = [...ROLE_PERMISSIONS.SERVICE];
  return {
    userId: "u1",
    role: "SERVICE",
    template,
    overrides: [],
    effective: template,
    ownerGranted: [],
  };
}

beforeEach(() => {
  api.permissions.mockResolvedValue(overview());
});

async function renderTable() {
  const view = render(
    <UserPermissionTable userId="u1" customerId={null} supplierId={null} />,
  );
  await waitFor(() =>
    screen.getByTestId(`terulet-${PERMISSION_AREAS[0]!.key}`),
  );
  return view;
}

describe("UserPermissionTable on the phone", () => {
  it("turns the table into blocks and keeps the header for screen readers", async () => {
    const { container } = await renderTable();
    expect(
      container.querySelector("table")!.classList.contains("max-md:block"),
    ).toBe(true);
    expect(
      container.querySelector("thead")!.classList.contains("max-md:sr-only"),
    ).toBe(true);
    expect(
      container.querySelector("tbody")!.classList.contains("max-md:block"),
    ).toBe(true);
  });

  it("gives every area row and every extra row the phone layout", async () => {
    const { container } = await renderTable();
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.length).toBeGreaterThanOrEqual(PERMISSION_AREAS.length);
    for (const row of rows) {
      expect(row.classList.contains("max-md:flex")).toBe(true);
    }
  });

  it("keeps the extra permissions indented under their area on the phone", async () => {
    const { container } = await renderTable();
    const extraCells = [...container.querySelectorAll("td[colspan='2']")];
    expect(extraCells.length).toBeGreaterThan(0);
    for (const cell of extraCells) {
      expect(cell.classList.contains("max-md:pl-4")).toBe(true);
    }
  });

  it("labels every template cell, so the phone shows Sablon: next to the level", async () => {
    const { container } = await renderTable();
    const rows = [...container.querySelectorAll("tbody tr")];
    for (const row of rows) {
      const last = row.querySelector("td:last-child")!;
      expect(last.getAttribute("data-label")).toBe("Sablon");
      expect(last.className).toContain(
        "max-md:before:content-[attr(data-label)",
      );
    }
  });
});
