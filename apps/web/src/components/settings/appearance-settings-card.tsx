"use client";

import {
  PilotCard,
  PilotCardHeader,
  PilotSegmentedControl,
  useThemePreference,
  type ThemePreference,
} from "@acropora/ui";

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
 * `figma-theme.css` fejlécét). A Beállítások lap maga 2026-11-26 óta
 * pilot-oldal (Picasso 3.16), tehát ez a kártya is a pilot készlettel áll,
 * a választó a közös szegmentált kapcsoló.
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

  const label = OPTIONS.find((option) => option.value === preference)?.label;
  return (
    <PilotCard className="overflow-hidden">
      <PilotCardHeader title="Megjelenés" />
      <div className="space-y-3 p-5">
        <p className="text-xs text-pilot-grey-600">
          Egyelőre csak az új, Figma-alapú felületeket érinti (ahol a képernyő
          már a friss tervet követi), a többi felület a mai kinézeten marad,
          amíg át nem kerül.
        </p>
        <PilotSegmentedControl
          options={OPTIONS.map((option) => option.label)}
          value={label ?? OPTIONS[2]!.label}
          onChange={(picked) => {
            const option = OPTIONS.find((o) => o.label === picked);
            if (option) setPreference(option.value);
          }}
        />
      </div>
    </PilotCard>
  );
}
