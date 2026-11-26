import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usersApi } from "@/lib/api/users";
import { UserCreatePage } from "./user-create-page";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub", variable: "pilot-inter" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/admin/users", fromWithinApp: false }),
}));
vi.mock("@/lib/api/users", () => ({
  usersApi: { create: vi.fn() },
}));
// the picker's two branches as buttons, like on the editor's test: what the page does with them is the question here
vi.mock("@/components/service-jobs/partner-picker", () => ({
  PartnerPicker: ({
    onPick,
    onClear,
  }: {
    onPick: (partner: { customerId: string }) => void;
    onClear: () => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onPick({ customerId: "customer-1" })}
      >
        Vevő kiválasztása
      </button>
      <button type="button" onClick={() => onClear()}>
        Vevő törlése
      </button>
    </>
  ),
}));
vi.mock("./role-labels", () => ({
  ROLE_LABELS: {
    VIEWER: "Megtekintő",
    SALES: "Értékesítő",
    PARTNER_SERVICE: "Partner szerviz",
  },
  ROLE_OPTIONS: [
    { value: "VIEWER", label: "Megtekintő" },
    { value: "SALES", label: "Értékesítő" },
    { value: "PARTNER_SERVICE", label: "Partner szerviz" },
  ],
}));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner-1",
    email: "owner@acropora.local",
    displayName: "Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const createButton = () =>
  screen.getByRole("button", { name: "Felhasználó létrehozása" });

/*
  ÚJ FELHASZNÁLÓ A KÖZÖS ŰRLAP-VÁZON (Picasso 3.20, kártya f0b70dbd). MI PIROSÍT: a lap nem a vázon áll (nincs "Mi történik ezután",
  nincs kötelező / nem kötelező jel); a létrehozó hívás más mezőket visz, mint amit a CreateUserInput tárol; a lap olyan mezőt kér
  (becenév, értesítés, képesség), amit a létrehozás eldob; a partner választása nem szűkíti a szerepet, vagy a törlése partner-szerepet
  hagy partner nélkül.
*/
describe("UserCreatePage", () => {
  beforeEach(() => {
    auth.session = session;
    router.push.mockReset();
    vi.mocked(usersApi.create).mockReset();
  });

  it("stands on the form scaffold and asks only what the create call stores", () => {
    render(<UserCreatePage />);
    expect(screen.getByText("Mi történik ezután")).toBeInTheDocument();
    expect(
      screen.getAllByText(/ott állítható a becenév, az értesítések/),
    ).toHaveLength(2);
    // Vezetéknév, Keresztnév, E-mail cím, Jelszó required; the partner and the role optional
    expect(screen.getAllByText("(kötelező)")).toHaveLength(4);
    expect(screen.getAllByText("(nem kötelező)")).toHaveLength(2);
    expect(screen.queryByLabelText("Becenév")).toBeNull();
    expect(screen.queryByText("Értesítések")).toBeNull();
    expect(screen.queryByText("Képességek")).toBeNull();
  });

  it("names what is missing beside the pale button, and creates with exactly the stored fields", async () => {
    vi.mocked(usersApi.create).mockResolvedValue({ id: "user-9" } as never);
    render(<UserCreatePage />);
    expect(createButton()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        "Hiányzik: Vezetéknév, Keresztnév, E-mail cím, Jelszó (legalább 8 karakter)",
      ),
    ).toBeInTheDocument();
    type("Vezetéknév", "Kovács");
    type("Keresztnév", "Anna");
    type("E-mail cím", "anna@acropora.local");
    type("Jelszó", "rövid");
    expect(
      screen.getByText("Hiányzik: Jelszó (legalább 8 karakter)"),
    ).toBeInTheDocument();
    type("Jelszó", "elegendoen-hosszu");
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(usersApi.create).toHaveBeenCalledWith("token-1", {
        firstName: "Anna",
        lastName: "Kovács",
        email: "anna@acropora.local",
        role: "VIEWER",
        password: "elegendoen-hosszu",
        customerId: null,
      }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/admin/users/user-9"),
    );
  });

  it("a picked partner makes the role Partner szerviz and offers only that; clearing it takes the role back", () => {
    render(<UserCreatePage />);
    const roleSelect = () =>
      screen.getByLabelText("Szerepkör") as HTMLSelectElement;
    expect(roleSelect().options).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Vevő kiválasztása" }));
    expect(roleSelect().value).toBe("PARTNER_SERVICE");
    expect([...roleSelect().options].map((option) => option.value)).toEqual([
      "PARTNER_SERVICE",
    ]);
    expect(
      screen.getByText(/szerepe szándékosan csak Partner szerviz lehet/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vevő törlése" }));
    expect(roleSelect().value).toBe("VIEWER");
    expect(roleSelect().options).toHaveLength(3);
  });

  it("a taken e-mail says so", async () => {
    const { ApiError } = await import("@/lib/api/client");
    vi.mocked(usersApi.create).mockRejectedValue(new ApiError("conflict", 409));
    render(<UserCreatePage />);
    type("Vezetéknév", "Kovács");
    type("Keresztnév", "Anna");
    type("E-mail cím", "anna@acropora.local");
    type("Jelszó", "elegendoen-hosszu");
    fireEvent.click(createButton());
    expect(
      await screen.findByText("Az e-mail cím már használatban van."),
    ).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});
