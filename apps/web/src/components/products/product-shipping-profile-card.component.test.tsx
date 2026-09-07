import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductShippingProfileCard } from "./product-shipping-profile-card";

const api = vi.hoisted(() => ({
  getShippingProfile: vi.fn(),
  saveShippingProfile: vi.fn(),
}));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

const profil = (overrides: Record<string, unknown> = {}) => ({
  productId: "product-1",
  pickupOnly: false,
  foxpostForbidden: false,
  isHeavy: false,
  isFrozen: false,
  updatedAt: "2026-09-07T10:00:00.000Z",
  ...overrides,
});

/*
  A valasz egy makrotaskkal kesobb erkezik, szandekosan. Egy `mockResolvedValue`
  ugyanabban a tickben rendezodik, tehat a varakozasok akkor is "sikerulnenek",
  ha rosszul lennenek megirva -- ma epp ezen bukott el a CI egy masik lapon.
*/
const kesobb = <T,>(value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), 0));

describe("ProductShippingProfileCard", () => {
  beforeEach(() => {
    api.getShippingProfile.mockReset();
    api.saveShippingProfile.mockReset();
  });

  /**
   * A LEGFONTOSABB ALLITAS: a hianyzo profil NEM negy "nem".
   *
   * A tablan egyik oszlopnak sincs alapertelmezese, mert a hianyzo ertek azt
   * jelenti, hogy MEG SENKI NEM NEZTE MEG. Ha a felulet itt negy "nem"-et
   * mutatna, a kulonbseg pont ott veszne el, ahol ember nezi.
   */
  it("profil nélkül NEM négy nemet mutat, hanem megmondja, hogy nem vizsgáltuk", async () => {
    api.getShippingProfile.mockReturnValue(kesobb(null));

    render(
      <ProductShippingProfileCard
        token="token-1"
        productId="product-1"
        canManage
      />,
    );

    expect(
      await screen.findByText("Még senki nem vizsgálta meg ezt a terméket."),
    ).toBeTruthy();
    expect(screen.queryByText(/Nehéz áru: nem/)).toBeNull();
  });

  /**
   * ES A POZITIV KONTROLL: egy MEGVIZSGALT termek, amire egyik jelzo sem all,
   * IGENIS negy "nem"-et mutat. Enelkul az elozo allitas ures: egy olyan lap is
   * kielegitene, ami soha semmit nem rajzol ki.
   */
  it("megvizsgált terméknél a csupa nem IS látszik", async () => {
    api.getShippingProfile.mockReturnValue(kesobb(profil()));

    render(
      <ProductShippingProfileCard
        token="token-1"
        productId="product-1"
        canManage
      />,
    );

    expect(await screen.findByText("Nehéz áru: nem")).toBeTruthy();
    expect(
      screen.queryByText("Még senki nem vizsgálta meg ezt a terméket."),
    ).toBeNull();
  });

  /**
   * MIND A NEGY JELZO MEGY EL, NEM CSAK A MEGVALTOZOTT.
   *
   * A vegpont mind a negyet koveteli; egy reszleges torzs a szerveren hasalna
   * el, es ha valaki ott "megjavitana" egy `?? false` alappal, a nem erintett
   * jelzok csendben nemre allnanak.
   */
  it("mentéskor MIND A NÉGY jelzőt elküldi", async () => {
    api.getShippingProfile.mockReturnValue(kesobb(profil()));
    api.saveShippingProfile.mockReturnValue(kesobb(profil({ isHeavy: true })));

    render(
      <ProductShippingProfileCard
        token="token-1"
        productId="product-1"
        canManage
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Módosítás" }));
    fireEvent.click(await screen.findByLabelText(/Nehéz áru/));
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => {
      expect(api.saveShippingProfile).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        {
          pickupOnly: false,
          foxpostForbidden: false,
          isHeavy: true,
          isFrozen: false,
        },
      );
    });
  });

  it("jog nélkül nincs szerkesztő gomb", async () => {
    api.getShippingProfile.mockReturnValue(kesobb(profil()));

    render(
      <ProductShippingProfileCard
        token="token-1"
        productId="product-1"
        canManage={false}
      />,
    );

    await screen.findByText("Nehéz áru: nem");
    expect(screen.queryByRole("button", { name: "Módosítás" })).toBeNull();
  });
});
