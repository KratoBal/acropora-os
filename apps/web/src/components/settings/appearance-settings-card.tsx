"use client";

import { Card, CardContent, CardHeader } from "@acropora/ui";

import { useThemePreference } from "@/lib/theme/use-theme-preference";
import type { ThemePreference } from "@/lib/theme/theme-preference";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Világos" },
  { value: "dark", label: "Sötét" },
  { value: "system", label: "Rendszer szerint" },
];

/**
 * VILÁGOS / SÖTÉT / RENDSZER SZERINT -- MINDENKINEK, JOGOSULTSÁGTÓL
 * FÜGGETLENÜL.
 *
 * Balázs döntése (2026-09-24 18:00 UTC): a választó a Beállításokba
 * kerül, weben és mobilon is, a választás megmarad. SZÁNDÉKOSAN NEM a
 * `SETTINGS_AREAS` jogosultság-szűrt hálóban áll: ez egy SZEMÉLYES
 * megjelenítési preferencia, nem üzleti jogkör -- a `SettingsLink`
 * típus mindkét ága (`entryId` a menüből, `permission` egy jogkör) egy
 * SZEREPKÖRHÖZ kötné, holott ennek minden bejelentkezett felhasználónál
 * ugyanúgy meg kell jelennie.
 *
 * MA CSAK A FIGMA-SZERŰ OLDALAKAT ÉRINTI (lásd `PilotThemeRoot` és
 * `figma-theme.css` fejlécét) -- ez a kártya viszont ettől függetlenül,
 * a mai (nem pilot) arculatban jelenik meg, mert a Beállítások lap maga
 * még nem Figma-szerű oldal ebben a körben.
 *
 * A LÁBSZÖVEG SZÁNDÉKOSAN NEM NEVEZ MEG OLDALT NÉVSZERINT (murena,
 * 2026-09-24, kanban 9728c62c): korábban "Akváriumok és Mérési
 * előzmények" állt itt, és az a mondat HAMISSÁ vált, amint a Hibajegyek
 * lista (#1071) is `PilotThemeRoot`-ot kapott -- a gépezet
 * domain-független, tehát minden újonnan pilot-stílusú oldal
 * automatikusan bekerül, a szöveg viszont csak akkor követte volna, ha
 * valaki minden körben újraírja. A mostani alak a MECHANIZMUST írja le
 * ("Figma-alapú felületek"), nem egy felsorolást, ezért a következő
 * pilot-oldal bevezetésekor sem kell hozzányúlni.
 */
export function AppearanceSettingsCard() {
  const { preference, setPreference } = useThemePreference();

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-dusk-900">Megjelenés</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-dusk-500">
          Egyelőre csak az új, Figma-alapú felületeket érinti (ahol a képernyő
          már a friss tervet követi) -- a többi felület a mai kinézeten marad,
          amíg át nem kerül.
        </p>
        <div className="inline-flex gap-1 rounded-md bg-dusk-100 p-1">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPreference(option.value)}
              aria-pressed={preference === option.value}
              className={`cursor-pointer rounded px-3 py-1.5 text-sm font-medium transition ${
                preference === option.value
                  ? "bg-white text-dusk-900 shadow-sm"
                  : "text-dusk-500 hover:text-dusk-700"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
