import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import {
  applyServerThemePreference,
  chooseThemePreference,
  holdThemeForServer,
  resetThemeStateForTests,
  setThemePreferencePersistence,
  useThemePreference,
} from "@acropora/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  THE THEME ON THE ACCOUNT (Balázs, 2026-11-09: on the phone's browser he had to switch to light every time; card
  302951c0). WHAT TURNS THIS RED: the phone's dark mode shown before the account's light theme arrives (no cached
  value); the account's value not winning over the cached one, or not cached; a "not chosen" answer wiping the
  browser's own choice; a choice that reaches only the view that made it; a choice not saved to the account, or a
  failed save that throws; the partner portal (no server) waiting for a server that never answers.
*/
function phoneIsDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  resetThemeStateForTests();
  phoneIsDark(true);
});
afterEach(() => resetThemeStateForTests());

describe("the theme store", () => {
  it("waits for the account in light, not in the phone's dark mode, when nothing is cached", async () => {
    holdThemeForServer();
    const { result } = renderHook(() => useThemePreference());
    await waitFor(() => expect(result.current.preference).toBe("system"));
    expect(result.current.effectiveTheme).toBe("light");

    act(() => applyServerThemePreference("light"));
    expect(result.current.effectiveTheme).toBe("light");
    expect(window.localStorage.getItem("acropora-theme-preference")).toBe(
      "light",
    );
  });

  it("the account's value wins over the cached one, and is cached", async () => {
    window.localStorage.setItem("acropora-theme-preference", "dark");
    holdThemeForServer();
    const { result } = renderHook(() => useThemePreference());
    await waitFor(() => expect(result.current.effectiveTheme).toBe("dark"));

    act(() => applyServerThemePreference("light"));
    expect(result.current.effectiveTheme).toBe("light");
    expect(window.localStorage.getItem("acropora-theme-preference")).toBe(
      "light",
    );
  });

  it("an account with no choice keeps the browser's own", async () => {
    window.localStorage.setItem("acropora-theme-preference", "light");
    holdThemeForServer();
    const { result } = renderHook(() => useThemePreference());
    act(() => applyServerThemePreference(null));
    expect(result.current.preference).toBe("light");
    expect(result.current.effectiveTheme).toBe("light");
  });

  it("without a server (the partner portal) it does not wait: the system decides at once", async () => {
    const { result } = renderHook(() => useThemePreference());
    await waitFor(() => expect(result.current.effectiveTheme).toBe("dark"));
  });

  it("a choice reaches every view at once and is saved to the account; a failed save does not throw", async () => {
    holdThemeForServer();
    const saved: string[] = [];
    setThemePreferencePersistence(async (preference) => {
      saved.push(preference);
      throw new Error("offline");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    function View({ name }: { name: string }) {
      const { effectiveTheme } = useThemePreference();
      return <span data-testid={name}>{effectiveTheme}</span>;
    }
    render(
      <>
        <View name="shell" />
        <View name="page" />
      </>,
    );
    act(() => applyServerThemePreference("light"));
    act(() => chooseThemePreference("dark"));
    expect(screen.getByTestId("shell")).toHaveTextContent("dark");
    expect(screen.getByTestId("page")).toHaveTextContent("dark");
    expect(saved).toEqual(["dark"]);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(window.localStorage.getItem("acropora-theme-preference")).toBe(
      "dark",
    );
    warn.mockRestore();
  });

  /*
    A SHARED BROWSER (barracuda, #2310): person A's cached choice must not stay with person B whose account has none;
    B's own cached choice does stay, and a choice is cached under the account that made it.
  */
  it("another account's cached value does not stay with an account that has none", () => {
    window.localStorage.setItem("acropora-theme-preference", "dark");
    window.localStorage.setItem("acropora-theme-preference-owner", "user-a");
    holdThemeForServer();
    const { result } = renderHook(() => useThemePreference());
    act(() => applyServerThemePreference(null, "user-b"));
    expect(result.current.preference).toBe("system");
    expect(window.localStorage.getItem("acropora-theme-preference")).toBeNull();
  });

  it("the account's own cached value stays when the account has none", () => {
    window.localStorage.setItem("acropora-theme-preference", "dark");
    window.localStorage.setItem("acropora-theme-preference-owner", "user-b");
    holdThemeForServer();
    const { result } = renderHook(() => useThemePreference());
    act(() => applyServerThemePreference(null, "user-b"));
    expect(result.current.preference).toBe("dark");
  });

  it("a choice is cached under the signed-in account", () => {
    holdThemeForServer();
    renderHook(() => useThemePreference());
    act(() => applyServerThemePreference("light", "user-a"));
    act(() => chooseThemePreference("dark"));
    expect(window.localStorage.getItem("acropora-theme-preference-owner")).toBe(
      "user-a",
    );
  });
});

/*
  THE AUTH PROVIDER BINDS IT: the session's theme is applied once the session is known, and a choice is saved through
  `PUT /auth/me/theme` while signed in.
*/
const adapter = vi.hoisted(() => ({ restore: vi.fn(), login: vi.fn() }));
vi.mock("@/lib/auth/production-auth", () => ({
  ProductionAuthAdapter: class {
    restoreSession = adapter.restore;
    login = adapter.login;
    logout = vi.fn();
  },
}));
vi.mock("@/lib/auth/development-auth", () => ({
  DevelopmentAuthAdapter: class {
    restoreSession = adapter.restore;
    login = adapter.login;
    logout = vi.fn();
  },
}));
const prefs = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock("@/lib/api/auth-preferences", () => ({ authPreferencesApi: prefs }));

describe("the auth provider and the account's theme", () => {
  it("applies the session's theme and saves a choice to the account", async () => {
    const { AuthProvider } = await import("@/components/auth/auth-provider");
    window.localStorage.setItem("acropora-theme-preference", "dark");
    adapter.restore.mockResolvedValue({
      id: "s1",
      token: "t1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u1",
        email: "balazs@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        customerId: null,
        supplierId: null,
        themePreference: "light",
      },
    } as Session);
    prefs.setTheme.mockResolvedValue({ themePreference: "system" });
    function View() {
      const { effectiveTheme } = useThemePreference();
      return <span data-testid="view">{effectiveTheme}</span>;
    }
    render(
      <AuthProvider>
        <View />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("view")).toHaveTextContent("light"),
    );
    act(() => chooseThemePreference("system"));
    expect(prefs.setTheme).toHaveBeenCalledWith("t1", "system");
  });

  it("a later session object of the same person does not bring the older value back over a choice", async () => {
    const { AuthProvider, useAuth } =
      await import("@/components/auth/auth-provider");
    const session = {
      id: "s1",
      token: "t1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u1",
        email: "balazs@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        customerId: null,
        supplierId: null,
        themePreference: "light",
      },
    } as Session;
    adapter.restore.mockResolvedValue(session);
    adapter.login.mockResolvedValue({ ...session, user: { ...session.user } });
    prefs.setTheme.mockResolvedValue({ themePreference: "dark" });
    function View() {
      const { effectiveTheme } = useThemePreference();
      const { login } = useAuth();
      return (
        <button type="button" onClick={() => void login("x")}>
          {effectiveTheme}
        </button>
      );
    }
    render(
      <AuthProvider>
        <View />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveTextContent("light"),
    );
    act(() => chooseThemePreference("dark"));
    await act(async () => screen.getByRole("button").click());
    await waitFor(() => expect(adapter.login).toHaveBeenCalled());
    expect(screen.getByRole("button")).toHaveTextContent("dark");
  });
});
