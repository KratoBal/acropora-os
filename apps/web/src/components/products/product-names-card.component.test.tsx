import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductNamesCard } from "./product-names-card";

const api = vi.hoisted(() => ({
  updateNames: vi.fn(),
  update: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("@/lib/api/products", () => ({ productApi: api }));

/*
  MI PIROSIT (kartya 20b0dd47, S3). A blokk megjelenik halnal vagy nem elo allatnal (a Nevek csak a korallnak es a
  gerincteleneknek valo); nem jelenik meg koralnal; a mostani nevek nem toltodnek be; a mentes MINDHAROM nevet kuldi (egy
  megsem kitoltott termeken adatlap-sort hozna letre); a torles nem uresen kuldott mezo; hiba utan nincs visszaolvasas; a
  megtekinto (jog nelkul) szerkeszthet; a visszaolvasott termek nem kerul a kepernyore.
*/
const product = (overrides: Partial<ProductDetail> = {}): ProductDetail =>
  ({
    id: "product-1",
    name: "Acropora tenuis",
    livestockKind: "CORAL",
    magyarNev: null,
    angolNev: null,
    nemetNev: null,
    ...overrides,
  }) as unknown as ProductDetail;

beforeEach(() => {
  api.updateNames.mockReset();
  api.update.mockReset();
  api.detail.mockReset();
});

describe("Az élő állatok nevei", () => {
  // acrobot 46058: the fish too, not only the coral and the invertebrate
  it.each([null])("nem jelenik meg élő állaton kívül: %s", (kind) => {
    const { container } = render(
      <ProductNamesCard
        token="t"
        product={product({ livestockKind: kind } as Partial<ProductDetail>)}
        canManage
        onSaved={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it.each(["CORAL", "INVERTEBRATE", "FISH"])(
    "megjelenik és a mostani neveket mutatja: %s",
    (kind) => {
      render(
        <ProductNamesCard
          token="t"
          product={product({
            livestockKind: kind,
            magyarNev: "Szarvkorall",
            angolNev: "Staghorn coral",
            nemetNev: "Hirschgeweihkoralle",
          } as Partial<ProductDetail>)}
          canManage
          onSaved={vi.fn()}
        />,
      );
      expect(
        (screen.getByLabelText("Magyar név") as HTMLInputElement).value,
      ).toBe("Szarvkorall");
      expect(
        (screen.getByLabelText("Angol név") as HTMLInputElement).value,
      ).toBe("Staghorn coral");
      expect(
        (screen.getByLabelText("Német név") as HTMLInputElement).value,
      ).toBe("Hirschgeweihkoralle");
    },
  );

  it("csak a változott mezőt küldi, és a szerverről visszaolvasott terméket teszi ki", async () => {
    const reread = product({ angolNev: "Staghorn coral" });
    api.updateNames.mockResolvedValue(undefined);
    api.detail.mockResolvedValue(reread);
    const onSaved = vi.fn();
    render(
      <ProductNamesCard
        token="t"
        product={product({ magyarNev: "Szarvkorall" })}
        canManage
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Angol név"), {
      target: { value: "  Staghorn coral " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(reread));
    expect(api.updateNames).toHaveBeenCalledWith("t", "product-1", {
      angolNev: "Staghorn coral",
    });
    expect(api.detail).toHaveBeenCalledWith("t", "product-1");
  });

  it("a név törlése üres szöveget küld (a szerver null-ra teszi)", async () => {
    api.updateNames.mockResolvedValue(undefined);
    api.detail.mockResolvedValue(product());
    render(
      <ProductNamesCard
        token="t"
        product={product({ nemetNev: "Hirschgeweihkoralle" })}
        canManage
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Német név"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.updateNames).toHaveBeenCalled());
    expect(api.updateNames).toHaveBeenCalledWith("t", "product-1", {
      nemetNev: "",
    });
  });

  it("változás nélkül nem küld semmit, és ezt kimondja", async () => {
    render(
      <ProductNamesCard
        token="t"
        product={product({ magyarNev: "Szarvkorall" })}
        canManage
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText("Nincs változás, nincs mit menteni."),
    ).toBeTruthy();
    expect(api.updateNames).not.toHaveBeenCalled();
  });

  it("hiba esetén kiírja, és nem olvas vissza", async () => {
    api.updateNames.mockRejectedValue(new Error("A szerver nem fogadta el."));
    const onSaved = vi.fn();
    render(
      <ProductNamesCard
        token="t"
        product={product()}
        canManage
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Magyar név"), {
      target: { value: "Új" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("A szerver nem fogadta el.")).toBeTruthy();
    expect(api.detail).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("jog nélkül a mezők le vannak tiltva, és nincs mentés gomb", () => {
    render(
      <ProductNamesCard
        token="t"
        product={product({ magyarNev: "Szarvkorall" })}
        canManage={false}
        onSaved={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText("Magyar név") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
  });

  it("egy újratöltött termék a szerver értékeit mutatja a régi piszkozat helyett", () => {
    const { rerender } = render(
      <ProductNamesCard
        token="t"
        product={product()}
        canManage
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Magyar név"), {
      target: { value: "piszkozat" },
    });
    rerender(
      <ProductNamesCard
        token="t"
        product={product({ magyarNev: "Szarvkorall" })}
        canManage
        onSaved={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText("Magyar név") as HTMLInputElement).value,
    ).toBe("Szarvkorall");
  });

  it("a nevek a kulon nev-vegponton mennek, nem a termek altalanos frissiteten (UNAS-gazdaju termeken az 409)", async () => {
    api.updateNames.mockResolvedValue(undefined);
    api.detail.mockResolvedValue(product());
    render(
      <ProductNamesCard
        token="t"
        product={product({
          catalogAuthority: "UNAS",
        } as Partial<ProductDetail>)}
        canManage
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Német név"), {
      target: { value: "Steinkoralle" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.updateNames).toHaveBeenCalled());
    expect(api.update).not.toHaveBeenCalled();
  });
});
