import { existsSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { settingsNavigation } from "../navigation";
import { SETTINGS_AREAS, SettingsOverviewPage } from "./settings-overview-page";

const auth = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "SALES" }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: auth.role },
    },
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const APP = join(process.cwd(), "src", "app", "(shell)");
const oldalFajlja = (href: string) =>
  join(APP, ...href.replace(/^\//, "").split("/"), "page.tsx");

describe("beállítások gyűjtőoldal", () => {
  /**
   * EZ AZ ALLITAS A LAP LETEZESENEK OKA, ES A LISTAJA A FORRASBOL JON.
   *
   * A lap azert keszult, mert a `/beallitasok` menupont 404-et adott. Egy
   * gyujtooldal, ami maga is nem letezo oldalakra mutat, ugyanazt a hibat adja
   * vissza egy kattintassal kesobb -- es epp ez tortent volna: a terv ket
   * olyan utat sorolt (`/admin/integrations`, `/admin/imports`), ami KONYVTAR
   * `page.tsx` nelkul.
   *
   * A merce ezert nem egy kezzel irt lista, hanem a FAJLRENDSZER: minden
   * hivatkozashoz letezzen a hozza tartozo `page.tsx`.
   */
  it("minden hivatkozása létező oldalra mutat", () => {
    const hianyzo = SETTINGS_AREAS.flatMap((area) => area.links)
      .map((link) => link.href)
      .filter((href) => !existsSync(oldalFajlja(href)));
    expect(hianyzo).toEqual([]);
  });

  /**
   * ISMERT POZITIV KONTROLL A FENTI MERESHEZ. Ha az utvonal-kepzesem rossz
   * (mas gyoker, mas kiterjesztes), a fenti allitas AKKOR IS zold lenne, mert
   * minden fajlt hianyzonak latna... es akkor a `hianyzo` NEM lenne ures.
   * Forditva viszont NEM latszik: egy olyan hiba, amitol MINDEN utat letezonek
   * lat, csendben atengedne barmit. Ezert megnezzuk, hogy egy szandekosan
   * kitalalt ut TENYLEG hianyzonak latszik.
   */
  it("a létezés-mérés meg tudja találni a hiányt", () => {
    expect(existsSync(oldalFajlja("/admin/users"))).toBe(true);
    expect(existsSync(oldalFajlja("/nincs-ilyen-oldal"))).toBe(false);
  });

  /**
   * A KOR BEZARASA: A MENUPONT CELJA IS LETEZIK.
   *
   * A lap azert keszult, mert a menuben allo `/beallitasok` sehova nem vezetett.
   * Az utvonal a NAVIGACIO FORRASABOL jon, nem ittani masolatbol: ha valaki
   * atirja a menupontot egy masik utra, ez az allitas vele mozdul.
   */
  it("a Beállítások menüpont célja is létezik", () => {
    const belepes = settingsNavigation.find(
      (item) => item.entryId === "settings-general",
    );
    expect(belepes).toBeDefined();
    expect(existsSync(oldalFajlja(belepes!.href))).toBe(true);
  });

  it("mind az öt területet megmutatja a tulajdonosnak", () => {
    auth.role = "OWNER";
    render(<SettingsOverviewPage />);
    for (const cim of [
      "Felhasználók",
      "Márkák",
      "Integrációk",
      "Importok",
      "Matricák",
    ]) {
      expect(screen.getAllByText(cim).length).toBeGreaterThan(0);
    }
  });

  /**
   * EGY-LINKES TERULETNEL A CIM PONTOSAN EGYSZER ALL OTT.
   *
   * Az elso valtozat minden kartyat cim PLUSZ lista alakban adott, es ettol a
   * "Felhasznalok" es a "Markak" KETSZER allt a kepernyon -- egyszer a kartya
   * cimekent, egyszer a sajat linkjekent. Merve, mielott a javitas keszult:
   * ket elofordulas mindkettonel.
   *
   * Ez nem esztetikai allitas: egy ketszer kiirt nev azt sugallja, hogy KET
   * kulonbozo dologrol van szo.
   */
  it("egy-linkes területnél a nevet nem írja ki kétszer", () => {
    auth.role = "OWNER";
    render(<SettingsOverviewPage />);
    expect(screen.getAllByText("Felhasználók")).toHaveLength(1);
    expect(screen.getAllByText("Márkák")).toHaveLength(1);
  });

  /**
   * A TOBB-LINKES TERULET MINDEN LINKJE LATSZIK, ES A KARTYA NEM VALASZT
   * HELYETTUK. Negybol egyet kiemelni onkenyes lenne, a masik harom pedig
   * lathatatlan maradna -- pontosan az a hiba, amit ez a lap javit, csak
   * eggyel beljebb.
   */
  it("a több oldalas területnél mind a négy hivatkozás ott áll", () => {
    auth.role = "OWNER";
    render(<SettingsOverviewPage />);
    for (const nev of [
      "UNAS kapcsolat",
      "UNAS szinkron",
      "NAV",
      "Medusa kapcsolat",
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(nev) })).toBeTruthy();
    }
  });

  /**
   * A LINKET AZ UTVONALA AZONOSITJA, NEM A SZOVEGE. Az egy-linkes kartyan a
   * cim a TERULET neve, a menuben viszont "QR-kód nyomtatás" all ugyanarra a
   * lapra -- egy nevre allitott kereses ezert a megjelenites egy dontesehez
   * kotne az allitast, nem ahhoz, hogy a hivatkozas jo helyre visz.
   */
  it("a matricák hivatkozása a már létező alpontra visz", () => {
    auth.role = "OWNER";
    render(<SettingsOverviewPage />);
    const linkek = screen
      .getAllByRole("link")
      .map((elem) => elem.getAttribute("href"));
    expect(linkek).toContain("/beallitasok/matricak");
  });

  /**
   * A SZUKITES ALLITASA, NEM A MUKODESE. A SALES szerepkor `settings.manage`
   * jog nelkul all, tehat egyetlen olyan teruletet sem lathat, amit az kapuz.
   * Enelkul az allitasaink csak azt mernek, hogy a lap KIRAJZOL valamit -- egy
   * mindent mutato valtozattol nem kulonbozne.
   */
  it("jog nélkül nem kínál olyan hivatkozást, amire 403 jönne", () => {
    auth.role = "SALES";
    render(<SettingsOverviewPage />);
    expect(screen.queryByText("Matricák")).not.toBeInTheDocument();
    expect(screen.queryByText("Felhasználók")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /NAV/ })).not.toBeInTheDocument();
  });
});
