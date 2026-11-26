import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetCategoriesPage } from "./asset-categories-page";
import { AssetFunctionsPage } from "./asset-functions-page";

/*
  AZ ESZKÖZ-KATEGÓRIÁK ÉS AZ ESZKÖZ-FUNKCIÓK LISTÁJA (Picasso 3.24, acrobot 62208): 45 és 18 egyforma "Kivezetés" gomb, szűrő nélkül. MI PIROSÍT: ha a sor művelete újra teljes értékű másodlagos gomb;
  ha a gomb neve nem mondja meg, melyik sorra vonatkozik; ha egy hosszú listán nincs kereső, vagy egy rövidön van; ha a kereső nem szűr, vagy a "nincs találat" nem jelenik meg; ha a kivezetés a sor
  azonosítóját nem küldi.
*/
const cat = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
const fun = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/api/asset-categories", () => ({ assetCategoriesApi: cat }));
vi.mock("@/lib/api/asset-functions", () => ({ assetFunctionsApi: fun }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: { token: "t", user: { id: "u", role: "OWNER" } },
  }),
}));

const category = (n: number, isActive = true) => ({
  id: `c${n}`,
  name: `Kategória ${n}`,
  code: n === 3 ? "KOD3" : null,
  isActive,
  sortOrder: n,
});
const fn = (n: number, isActive = true) => ({
  id: `f${n}`,
  name: `Funkció ${n}`,
  isActive,
  sortOrder: n,
});

beforeEach(() => {
  cat.list.mockReset();
  cat.update.mockReset().mockResolvedValue({});
  fun.list.mockReset();
  fun.update.mockReset().mockResolvedValue({});
});

describe("AssetCategoriesPage list", () => {
  it("a sor műveletei halvány gombok, és mindegyik megmondja, melyik sorra vonatkozik", async () => {
    cat.list.mockResolvedValue({
      items: [category(1), category(2, false)],
    });
    render(<AssetCategoriesPage />);
    const retire = await screen.findByRole("button", {
      name: "Kivezetés: Kategória 1",
    });
    // halvány (ghost) gomb: nincs keret és nincs árnyék, nem a másodlagos gomb
    expect(retire.className).not.toContain("border-dusk-200");
    expect(retire.className).not.toContain("shadow-sm");
    expect(
      screen.getByRole("button", { name: "Visszahozás: Kategória 2" }),
    ).toBeTruthy();
    fireEvent.click(retire);
    await waitFor(() =>
      expect(cat.update).toHaveBeenCalledWith("t", "c1", { isActive: false }),
    );
  });

  it("hosszú listán van kereső (név és kód alapján), és szűr; rövid listán nincs", async () => {
    cat.list.mockResolvedValue({
      items: Array.from({ length: 12 }, (_, i) => category(i + 1)),
    });
    render(<AssetCategoriesPage />);
    const search = await screen.findByLabelText("Keresés a listában");
    expect(screen.getByText("12 sor")).toBeTruthy();
    fireEvent.change(search, { target: { value: "kod3" } });
    expect(screen.getByText("Kategória 3")).toBeTruthy();
    expect(screen.queryByText("Kategória 4")).toBeNull();
    expect(screen.getByText("1 / 12 sor")).toBeTruthy();
    fireEvent.change(search, { target: { value: "nincs ilyen" } });
    expect(
      screen.getByText("Nincs a keresésnek megfelelő kategória."),
    ).toBeTruthy();
  });

  it("egy rövid listán nincs kereső", async () => {
    cat.list.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, i) => category(i + 1)),
    });
    render(<AssetCategoriesPage />);
    await screen.findByText("Kategória 5");
    expect(screen.queryByLabelText("Keresés a listában")).toBeNull();
  });
});

describe("AssetFunctionsPage list", () => {
  it("a sor művelete halvány gomb a sor nevével", async () => {
    fun.list.mockResolvedValue({ items: [fn(1)] });
    render(<AssetFunctionsPage />);
    const retire = await screen.findByRole("button", {
      name: "Kivezetés: Funkció 1",
    });
    expect(retire.className).not.toContain("border-dusk-200");
    fireEvent.click(retire);
    await waitFor(() =>
      expect(fun.update).toHaveBeenCalledWith("t", "f1", { isActive: false }),
    );
  });

  it("hosszú listán kereső van és szűr, a nincs-találat kimondva", async () => {
    fun.list.mockResolvedValue({
      items: Array.from({ length: 10 }, (_, i) => fn(i + 1)),
    });
    render(<AssetFunctionsPage />);
    const search = await screen.findByLabelText("Keresés a listában");
    fireEvent.change(search, { target: { value: "funkció 7" } });
    expect(screen.getByText("Funkció 7")).toBeTruthy();
    expect(screen.queryByText("Funkció 2")).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(
      screen.getByText("Nincs a keresésnek megfelelő funkció."),
    ).toBeTruthy();
  });
});
