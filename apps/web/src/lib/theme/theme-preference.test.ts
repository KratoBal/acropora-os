import { beforeEach, describe, expect, it } from "vitest";

import {
  readThemePreference,
  resolveEffectiveTheme,
  writeThemePreference,
} from "./theme-preference";

describe("resolveEffectiveTheme", () => {
  it("light/dark preferencia független a rendszertől", () => {
    expect(resolveEffectiveTheme("light", true)).toBe("light");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
  });

  it("'system' preferencia a rendszer beállítását követi", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });
});

describe("readThemePreference / writeThemePreference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("alapértelmezetten 'system'-et ad, ha még nincs mentve semmi", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("visszaadja, amit korábban elmentettünk", () => {
    writeThemePreference("dark");
    expect(readThemePreference()).toBe("dark");
  });

  /*
    MI PIROSÍT: ha egy régebbi (vagy sérült) mentés érvénytelen sztringet
    hagyott a tárhelyen, egy naiv olvasás azt is preferenciaként adná
    vissza -- ez az állítás azt méri, hogy ilyenkor a biztonságos
    alapértelmezésre esik vissza, nem egy értelmezhetetlen értékre.
  */
  it("érvénytelen tárolt értéknél 'system'-re esik vissza", () => {
    window.localStorage.setItem("acropora-theme-preference", "kek");
    expect(readThemePreference()).toBe("system");
  });
});
