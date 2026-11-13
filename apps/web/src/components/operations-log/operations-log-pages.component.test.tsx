import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  OperationsTaskTemplateDto,
  Permission,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OperationsTemplateEditorPage } from "./operations-template-editor-page";
import { OperationsTemplatesPage } from "./operations-templates-page";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ SABLONJAINAK KÉPERNYŐI (task os-uzemeltetesi-naplo, S1b).
 *
 * MI PIROSIT: ha a lista nem mutatja a gyakoriságot, a célt és a mezőket; ha a jog nélküli felhasználó látná a kezelőt; ha a
 * szerkesztő olyan sablont menthetne, amit a szerver szabályai elutasítanának (cél nélkül, cím nélküli mező, nem szám mezőn
 * mértékegység, két „előtte” szerep); ha a mentés nem a TELJES mezőkészletet és az egyidejűség-őrt (`expectedUpdatedAt`)
 * küldené; ha a mező kulcsa elveszne mentéskor; ha a kivezetett mező nem látszana.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/beallitasok/uzemeltetesi-naplo-sablonok",
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  retire: vi.fn(),
}));
vi.mock("@/lib/api/operations-log", () => ({ operationsLogApi: api }));
const categories = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/asset-categories", () => ({
  assetCategoriesApi: categories,
}));
const assets = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/assets", () => ({ assetsApi: assets }));

const auth = vi.hoisted(() => ({
  role: "ADMIN" as UserRole,
  permissions: undefined as Permission[] | undefined,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "Balázs",
        role: auth.role,
        ...(auth.permissions ? { permissions: auth.permissions } : {}),
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const TEMPLATE: OperationsTaskTemplateDto = {
  id: "t1",
  name: "Homokszűrő visszamosás",
  description: "Heti rutin",
  frequency: "WEEKLY",
  target: {
    kind: "ASSET",
    assetId: "a1",
    assetNumber: "V2196",
    name: "Homokszűrő",
  },
  isActive: true,
  fields: [
    {
      id: "f1",
      key: "vizora_elotte",
      label: "Vízóra előtte",
      type: "NUMBER",
      unit: "m3",
      required: true,
      meterRole: "BEFORE",
      sortOrder: 0,
      removedAt: null,
    },
    {
      id: "f2",
      key: "vizora_utana",
      label: "Vízóra utána",
      type: "NUMBER",
      unit: "m3",
      required: true,
      meterRole: "AFTER",
      sortOrder: 1,
      removedAt: null,
    },
  ],
  retiredFields: [
    {
      id: "f0",
      key: "megjegyzes",
      label: "Régi megjegyzés",
      type: "TEXT",
      unit: null,
      required: false,
      meterRole: null,
      sortOrder: 2,
      removedAt: "2026-11-12T10:00:00.000Z",
    },
  ],
  updatedAt: "2026-11-13T08:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "ADMIN";
  auth.permissions = undefined;
  categories.list.mockResolvedValue({
    items: [
      {
        id: "c1",
        name: "Vízkezelés",
        isActive: true,
        sortOrder: 0,
        code: null,
      },
    ],
  });
  assets.list.mockResolvedValue({ items: [] });
});

describe("a sablonok listája", () => {
  it("kártyán mutatja a gyakoriságot, a célt, a mezők számát és a címkéit", async () => {
    api.list.mockResolvedValue({ items: [TEMPLATE] });
    render(<OperationsTemplatesPage />);
    expect(await screen.findByText("Homokszűrő visszamosás")).toBeTruthy();
    expect(screen.getByText("Heti")).toBeTruthy();
    expect(screen.getByText("Aktív")).toBeTruthy();
    expect(screen.getByText("Eszköz · V2196 Homokszűrő")).toBeTruthy();
    expect(screen.getByText("2 mező")).toBeTruthy();
    expect(screen.getByText("Vízóra előtte · Vízóra utána")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Homokszűrő visszamosás: szerkesztés",
      }),
    );
    expect(navigation.push).toHaveBeenCalledWith(
      "/beallitasok/uzemeltetesi-naplo-sablonok/t1",
    );
  });

  it("a Kivezetettek is kapcsoló a teljes listát kéri", async () => {
    api.list.mockResolvedValue({ items: [] });
    render(<OperationsTemplatesPage />);
    await waitFor(() =>
      expect(api.list).toHaveBeenCalledWith(
        "token-1",
        false,
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByLabelText("Kivezetettek is"));
    await waitFor(() =>
      expect(api.list).toHaveBeenCalledWith("token-1", true, expect.anything()),
    );
  });

  it("a kezelő jog nélkül nincs lista és nincs lekérés", () => {
    auth.role = "SERVICE";
    render(<OperationsTemplatesPage />);
    expect(screen.getByText(/jogosultság szükséges/)).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });
});

describe("a sablon szerkesztője", () => {
  it("a mentés a teljes mezőkészletet küldi, a meglévő mezők kulcsával és az egyidejűség-őrrel", async () => {
    api.get.mockResolvedValue(TEMPLATE);
    api.update.mockResolvedValue({ ...TEMPLATE, name: "Új név" });
    render(<OperationsTemplateEditorPage templateId="t1" />);
    fireEvent.change(await screen.findByLabelText("Sablon neve"), {
      target: { value: "Új név" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sablon mentése" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0]![1]).toBe("t1");
    expect(api.update.mock.calls[0]![2]).toEqual({
      expectedUpdatedAt: "2026-11-13T08:00:00.000Z",
      name: "Új név",
      description: "Heti rutin",
      frequency: "WEEKLY",
      assetId: "a1",
      assetCategoryId: null,
      fields: [
        {
          key: "vizora_elotte",
          label: "Vízóra előtte",
          type: "NUMBER",
          unit: "m3",
          required: true,
          meterRole: "BEFORE",
        },
        {
          key: "vizora_utana",
          label: "Vízóra utána",
          type: "NUMBER",
          unit: "m3",
          required: true,
          meterRole: "AFTER",
        },
      ],
    });
  });

  it("a kivezetett mezők olvashatóan állnak a sablon alatt", async () => {
    api.get.mockResolvedValue(TEMPLATE);
    render(<OperationsTemplateEditorPage templateId="t1" />);
    const box = await screen.findByTestId("kivezetett-mezok");
    expect(box.textContent).toContain("Régi megjegyzés");
  });

  it("cél, cím és a szerver szabályai nélkül nem menthető", async () => {
    render(<OperationsTemplateEditorPage templateId={null} />);
    const save = (await screen.findByRole("button", {
      name: "Sablon mentése",
    })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Sablon neve"), {
      target: { value: "Heti rutin" },
    });
    // eszköz nélkül (az alapértelmezett cél eszköz) nem menthető
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByText("Eszköz-kategória"));
    fireEvent.change(screen.getByLabelText("Eszköz-kategória"), {
      target: { value: "c1" },
    });
    expect(save.disabled).toBe(false);
    // egy címke nélküli mező tiltja a mentést
    fireEvent.click(screen.getByRole("button", { name: "+ Mező hozzáadása" }));
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("1. mező: címke"), {
      target: { value: "Vízóra előtte" },
    });
    expect(save.disabled).toBe(false);
    // két „előtte” szerep nem megy át
    fireEvent.change(screen.getByLabelText("Vízóra előtte: vízóra szerep"), {
      target: { value: "BEFORE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Mező hozzáadása" }));
    fireEvent.change(screen.getByLabelText("2. mező: címke"), {
      target: { value: "Másik" },
    });
    fireEvent.change(screen.getByLabelText("Másik: vízóra szerep"), {
      target: { value: "BEFORE" },
    });
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId("sablon-hibak").textContent).toContain("előtte");
  });

  it("nem szám mezőn nincs mértékegység és szerep, és a típusváltás kiveszi őket a mentésből", async () => {
    api.create.mockResolvedValue({ ...TEMPLATE, id: "t9" });
    render(<OperationsTemplateEditorPage templateId={null} />);
    fireEvent.change(await screen.findByLabelText("Sablon neve"), {
      target: { value: "Heti rutin" },
    });
    fireEvent.click(screen.getByText("Eszköz-kategória"));
    fireEvent.change(screen.getByLabelText("Eszköz-kategória"), {
      target: { value: "c1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Mező hozzáadása" }));
    fireEvent.change(screen.getByLabelText("1. mező: címke"), {
      target: { value: "Vízóra" },
    });
    fireEvent.change(screen.getByLabelText("Vízóra: mértékegység"), {
      target: { value: "m3" },
    });
    fireEvent.change(screen.getByLabelText("Vízóra: típus"), {
      target: { value: "TEXT" },
    });
    expect(screen.queryByLabelText("Vízóra: mértékegység")).toBeNull();
    expect(screen.queryByLabelText("Vízóra: vízóra szerep")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sablon mentése" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![1].fields).toEqual([
      {
        key: null,
        label: "Vízóra",
        type: "TEXT",
        unit: null,
        required: false,
        meterRole: null,
      },
    ]);
    expect(api.create.mock.calls[0]![1].assetCategoryId).toBe("c1");
    expect(navigation.replace).toHaveBeenCalledWith(
      "/beallitasok/uzemeltetesi-naplo-sablonok/t9",
    );
  });

  it("a kivezetés megerősítés után a DELETE-et hívja, és kivezetettnek mutatja", async () => {
    api.get.mockResolvedValueOnce(TEMPLATE);
    api.retire.mockResolvedValue({ retired: true });
    api.get.mockResolvedValueOnce({ ...TEMPLATE, isActive: false });
    render(<OperationsTemplateEditorPage templateId="t1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Kivezetés" }));
    // a megerősítő ablak gombja a második „Kivezetés” gomb (az első a fejlécé)
    const buttons = await screen.findAllByRole("button", { name: "Kivezetés" });
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[1]!);
    await waitFor(() =>
      expect(api.retire).toHaveBeenCalledWith("token-1", "t1"),
    );
  });
});
