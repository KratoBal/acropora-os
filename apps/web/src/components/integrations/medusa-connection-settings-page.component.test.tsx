import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  MedusaConnectionView,
  MedusaIntegrationStateKind,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MedusaConnectionSettingsPage } from "./medusa-connection-settings-page";

/**
 * A FELÜLET állításai.
 *
 * Kettő közülük olyan, aminek egész életében zöldnek kell lennie, és pont akkor
 * ér valamit, amikor egyszer pirosra vált: a titok nem jelenik meg sehol, és a
 * sérült kulcs nem látszik „nincs beállítva" állapotnak.
 */

const api = vi.hoisted(() => ({
  get: vi.fn(),
  replaceCredential: vi.fn(),
  test: vi.fn(),
  disable: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/medusa-connection", () => ({ medusaConnectionApi: api }));

const session = (role: "OWNER" | "VIEWER"): Session => ({
  id: `session-${role}`,
  token: `token-${role}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: role,
    email: `${role.toLowerCase()}@acropora.local`,
    displayName: role,
    role,
    customerId: null,
    supplierId: null,
  },
});

const view = (
  kind: MedusaIntegrationStateKind,
  source: "database" | "env" | null,
  extra: Partial<MedusaConnectionView> = {},
): MedusaConnectionView => ({
  configured: source === "database",
  masked: source === "database" ? "••••••••" : null,
  modifiedAt: "2026-08-25T12:00:00.000Z",
  state: { kind, source, detail: null, status: null },
  verification: { status: "SUCCESS", checkedAt: null, code: null },
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.session = session("OWNER");
  api.get.mockResolvedValue(view("ready", "database"));
});

describe("Medusa kapcsolat beállító lap", () => {
  it("keeps the settings behind the manage permission", async () => {
    auth.session = session("VIEWER");

    render(<MedusaConnectionSettingsPage />);

    expect(
      await screen.findByText(
        "Nincs hozzáférésed a Medusa kapcsolat beállításaihoz",
      ),
    ).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("shows the stored key as masked, and offers no way to read it", async () => {
    render(<MedusaConnectionSettingsPage />);

    expect(await screen.findByText("••••••••")).toBeTruthy();
    // A beviteli mező ÜRES marad: a meglévő kulcs nem tölthető vissza bele.
    const input = screen.getByLabelText(
      "Titkos admin kulcs",
    ) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
  });

  /**
   * A TARTALÉK ÚT nem egészséges alapértelmezés. Ha csak egy címke jelezné,
   * észrevétlenül állandósulna.
   */
  it("announces the environment fallback instead of showing it as normal", async () => {
    api.get.mockResolvedValue(view("ready", "env"));

    render(<MedusaConnectionSettingsPage />);

    expect(
      await screen.findByText(
        "A kulcs a környezeti változóból jön (tartalék út)",
      ),
    ).toBeTruthy();
  });

  it("says when the key comes from the store", async () => {
    render(<MedusaConnectionSettingsPage />);

    expect(await screen.findByText("A kulcs a tárolóból jön")).toBeTruthy();
  });

  /**
   * A SÉRÜLT kulcs a felületen sem látszhat „nincs beállítva" állapotnak: egy
   * hibás telepítés nem nézhet ki friss telepítésnek.
   */
  it("shows a corrupt credential as corrupt, not as missing", async () => {
    api.get.mockResolvedValue(view("credential-corrupt", null));

    render(<MedusaConnectionSettingsPage />);

    expect(await screen.findByText("A tárolt kulcs sérült")).toBeTruthy();
    expect(screen.queryByText("Nincs beállítva")).toBeNull();
  });

  /**
   * AZ ELUTASÍTÁS részletei a szervertől jönnek, és nem állítják, hogy a kulcs
   * rossz. A felület ezt továbbadja, nem fogalmazza át.
   */
  it("passes the rejection detail through without claiming the key is wrong", async () => {
    const detail =
      "A Medusa elutasította a kérést (403). Ez NEM jelenti automatikusan, hogy a kulcs rossz.";
    api.get.mockResolvedValue({
      ...view("auth-or-permission-failure", null),
      state: {
        kind: "auth-or-permission-failure" as const,
        source: null,
        detail,
        status: 403,
      },
    });

    render(<MedusaConnectionSettingsPage />);

    expect(await screen.findByText(detail)).toBeTruthy();
  });

  it("sends a new key and then forgets it", async () => {
    api.replaceCredential.mockResolvedValue(view("ready", "database"));

    render(<MedusaConnectionSettingsPage />);
    await screen.findByText("••••••••");

    const input = screen.getByLabelText(
      "Titkos admin kulcs",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk_uj_kulcs" } });
    fireEvent.click(screen.getByText("Mentés"));

    await waitFor(() =>
      expect(api.replaceCredential).toHaveBeenCalledWith("token-OWNER", {
        apiKey: "sk_uj_kulcs",
      }),
    );
    // A mező kiürül: a titoknak nincs miért a felület állapotában maradnia.
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("explains a cooldown as waiting, not as a broken key", async () => {
    api.test.mockRejectedValue(new Error("MEDUSA_CONNECTION_COOLDOWN"));

    render(<MedusaConnectionSettingsPage />);
    await screen.findByText("••••••••");

    fireEvent.click(screen.getByText("Kapcsolat ellenőrzése"));

    expect(await screen.findByText("A művelet nem sikerült.")).toBeTruthy();
  });

  /**
   * A MÉRT HIBA (2026-08-26): a lap a HTTP hívás sikerét jelentette be
   * ellenőrzésként. A végpont viszont akkor is 200-zal tér vissza, ha a próba
   * elbukott, mert az eredmény az állapotban van, nem a státuszkódban. Így a
   * „Kapcsolat ellenőrizve" mondat megjelenhetett egy „A Medusa nem érhető el"
   * jelvény mellett, ugyanazon a képernyőn.
   */
  it("does not call a failed probe a verified connection", async () => {
    api.test.mockResolvedValue(view("unreachable", "database"));

    render(<MedusaConnectionSettingsPage />);
    await screen.findByText("••••••••");

    fireEvent.click(screen.getByText("Kapcsolat ellenőrzése"));

    expect(
      await screen.findByText(
        "Az ellenőrzés lefutott, de nem sikerült. Az eredmény az állapotnál látszik.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText("A kapcsolat ellenőrizve: a Medusa válaszolt."),
    ).toBeNull();
  });

  it("says the connection answered when it actually answered", async () => {
    api.test.mockResolvedValue(view("ready", "database"));

    render(<MedusaConnectionSettingsPage />);
    await screen.findByText("••••••••");

    fireEvent.click(screen.getByText("Kapcsolat ellenőrzése"));

    expect(
      await screen.findByText("A kapcsolat ellenőrizve: a Medusa válaszolt."),
    ).toBeTruthy();
  });

  /**
   * A JELVÉNY A TÁROLT KULCS ÉPSÉGÉRŐL SZÓL, és a lap betöltésekor hálózat
   * nélkül készül: a „Működik" felirat nem jelenti azt, hogy bárki megkérdezte
   * volna a Medusát. Amíg az „Utolsó ellenőrzés" sor elrejtőzött, ha nem volt
   * még ellenőrzés, a két dolog egybeolvadt a képernyőn.
   */
  it("says the connection was never checked instead of hiding the row", async () => {
    api.get.mockResolvedValue(view("ready", "database"));

    render(<MedusaConnectionSettingsPage />);

    expect(await screen.findByText("Utolsó ellenőrzés")).toBeTruthy();
    expect(screen.getByText("még nem volt ellenőrizve")).toBeTruthy();
  });
});
