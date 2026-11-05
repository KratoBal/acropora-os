"use client";
import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "./icon";
import { huToIso, inRange, isoToHu, nextText } from "./hu-date";
import {
  HU_MONTHS,
  joinMonth,
  monthName,
  monthParts,
  monthYears,
} from "./hu-month";
import { PILOT_SHELL_BLEED } from "./page-frame";
import { useThemePreference } from "./use-theme-preference";

/**
 * KÍSÉRLETI, ÖNÁLLÓ MEGJELENÍTŐ ELEMEK -- MINDEN FIGMA PILOT OLDALNAK.
 *
 * Ezek NEM a `@acropora/ui` `Button`/`Card`/`Badge` cseréi: azok a mai közös
 * arculatot (`brand-*`/`dusk-*`) viselik, ez a készlet a Figma Make terv
 * `pilot-aqua-*`/`pilot-grey-*` tokenjeit. A két készlet szándékosan él
 * egymás mellett -- lásd `figma-theme.css` fejlécét, miért.
 *
 * IDE KÖLTÖZÖTT 2026-09-25-én, A PARTNER PORTÁL FIGMA-KÖRREL (acrobot
 * döntése): eddig `apps/web/src/components/pilot/` alatt állt, kizárólag a
 * webes pilot-oldalaknak. A tokenkészlet mindig is domain-semleges volt, a
 * FÁJL HELYE nem -- a CONTRIBUTING szabálya szerint ("ha egy komponenst
 * második helyen is használnál, oda kerül") a második fogyasztó
 * (`apps/partner`) mozdította ide.
 *
 * A `next/font/local` CSAPDA VOLT: ez a csomag NEM Next.js alkalmazás, tehát
 * a betűtípus-fájl build-idejű feldolgozása itt nem futtatható. A font ezért
 * APP-SZINTEN MARAD (`apps/web/src/components/pilot/pilot-font.ts`), és a
 * `PilotThemeRoot` `fontClassName` PARAMÉTERKÉNT kapja meg -- lásd lent.
 *
 * RÉGI HELYÉN NEM MARADT MÁSOLAT: `apps/web/src/components/pilot/pilot-ui.tsx`
 * mostantól csak újraexportál innen, ugyanaz a minta, mint a
 * `service-theme.ts` 2026-09-24-i költöztetésénél.
 *
 * A FORMA A FIGMA `src/App.tsx` MIKRO-KOMPONENSEIT KÖVETI (Badge, Avatar,
 * Btn, SegmentedControl, FormField, Input, Select, Card, CardHeader, Drawer,
 * Dialog), csak Tailwind class-nevekben `teal`/`grey` helyett `pilot-aqua`/
 * `pilot-grey`.
 */

// A keret margójának tükre: a definíció és az indoklás a `page-frame.ts`-ben (T1.2).
export { PILOT_SHELL_BLEED };

/**
 * A PILOT OLDALAK GYÖKERE -- EZ TESZI RÁ A `data-theme`-ET, ÉS CSAK EZ.
 *
 * Balázs döntése (2026-09-24 18:00 UTC): a világos/sötét választó a
 * Beállításokba kerül, a választás megmarad, és ELSŐ KÖRBEN csak a már
 * Figma-szerű oldalak (Akváriumok, Mérési előzmények) kapják meg mindkét
 * módban. A `data-theme` attribútum EZÉRT NEM a `<html>`-re kerül, hanem
 * KIZÁRÓLAG erre a gyökér elemre -- lásd `figma-theme.css` fejlécét: a
 * sötét-felülíró szabályok (`[data-theme="dark"] .bg-white` stb.) emiatt
 * szerkezetileg nem tudnak lefutni egyetlen olyan oldalon sem, amelyik nem
 * ezt a komponenst használja gyökérként.
 *
 * MINDEN PILOT OLDAL (a betöltési/skeleton ág IS) ezt használja gyökérként,
 * ne nyers `<div>`-et -- egy kihagyott betöltési ág a téma-váltáskor egy
 * pillanatra rossz módban villanna fel.
 *
 * `fontClassName` OPCIONÁLIS, ÉS SZÁNDÉKOSAN A HÍVÓ FELELŐSSÉGE: ez a csomag
 * nem Next.js alkalmazás, tehát a `next/font/local` betűtípus-betöltő itt
 * nem futtatható. Az `apps/web`-beli hívó (lásd a fájl fejlécét) a saját,
 * app-szinten maradt `pilotInter.className`-jét adja át; egy jövőbeli másik
 * fogyasztó akár egy másik fontot, akár semmit.
 */
export function PilotThemeRoot({
  children,
  className = "",
  fontClassName = "",
  theme,
  bleed = false,
}: {
  children?: ReactNode;
  className?: string;
  fontClassName?: string;
  /** A keret széléig érő háttér (`PILOT_SHELL_BLEED`), a kézi `-m-6` helyett. */
  bleed?: boolean;
  /**
   * A MÓD RÖGZÍTÉSE, HA A TERVNEK CSAK EGY MÓDJA VAN. A Direction F OS
   * oldalai (Termékek, 2026-09-30) csak világos értéket adnak a saját
   * változóiknak (a meleg és a zöld család: egyik Figma-használat sem tesz
   * rájuk sötét módot, acrobot mérte), ezért ott a lap világos marad a
   * beállított sötét preferencia mellett is. Ismert eltérés, nem hiba.
   * Megadás nélkül a beállítás dönt, ahogy eddig.
   */
  theme?: "light";
}) {
  const { effectiveTheme } = useThemePreference();
  return (
    <div
      data-theme={theme ?? effectiveTheme}
      className={`${fontClassName} ${bleed ? `${PILOT_SHELL_BLEED} ` : ""}${className}`}
    >
      {children}
    </div>
  );
}

export type PilotBadgeVariant =
  "teal" | "grey" | "amber" | "blue" | "danger" | "success" | "default";

export function PilotBadge({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: PilotBadgeVariant;
}) {
  const styles = {
    teal: "bg-pilot-aqua-50 text-pilot-aqua-700 ring-1 ring-pilot-aqua-200",
    grey: "bg-pilot-grey-100 text-pilot-grey-600 ring-1 ring-pilot-grey-200",
    /**
     * AMBER -- EGYETLEN VÁLTOZAT A FIGMA HIBAJEGY-TERV KÉT SZÍNÉRE
     * ("Válaszra vár" ÉS "Alkatrészre vár", az utóbbi eredetileg narancs).
     * NARANCS TOKEN NINCS FELVÉVE: a brief szerint ("Use ONLY those
     * tokens") csak a meglévő két készlet (`pilot-aqua-*`/`pilot-grey-*`)
     * és a már létező `pilot-amber-*` használható -- lásd
     * `figma-theme.css` fejlécét. A megkülönböztetés a CÍMKE SZÖVEGÉBEN
     * marad (a nyolc belső állapot neve), nem a színben.
     */
    amber: "bg-pilot-amber-50 text-pilot-amber-700 ring-1 ring-pilot-amber-100",
    /**
     * BLUE -- AZ ESZKÖZ-ÁLLAPOT KANONIKUS `assetStatusTone`-JÁHOZ
     * (packages/types/src/asset-management.ts), a két tartalék-állapot
     * (`WARM_STANDBY`/`COLD_STANDBY`) színe. Balázs 2026-09-15/16-i
     * döntése kifejezetten arról szólt, hogy ez a kettő LÁSSON MÁSKÉNT
     * ki, mint a javítás alatt álló (`amber`) -- egy harmadik szín
     * ehhez kellett, nem díszítés.
     */
    blue: "bg-pilot-blue-50 text-pilot-blue-700 ring-1 ring-pilot-blue-100",
    /**
     * DANGER -- A MUNKALAP KANONIKUS `worksheetStatusTone`-JÁHOZ
     * (packages/types/src/worksheet-management.ts), a `REJECTED` állapot
     * színe. A Figma Munkalapok terv is pirosat rajzol ide (`bg-red-50
     * text-red-600 ring-red-200`), tehát ez nem újítás -- a kanonikus tone
     * és a terv itt egyetért. `pilot-red-*` tokent kap, nem nyers
     * `red-*`-t, hogy sötét módban is olvasható maradjon -- lásd
     * `figma-theme.css`.
     */
    danger: "bg-pilot-red-50 text-pilot-red-700 ring-1 ring-pilot-red-100",
    /**
     * SUCCESS -- A DIRECTION F "AKTÍV" JELVÉNYE (Figma 273:15/273:16): saját
     * zöld, nem az aqua. Az aqua a Direction F-ben a primer művelet színe,
     * egy állapot szemantikus színt kap (Balázs briefje, 2026-09-30, 7.
     * pont). Keret nélkül, ahogy a terv rajzolja.
     */
    success: "bg-pilot-green-50 text-pilot-green-700",
    default: "bg-pilot-grey-100 text-pilot-grey-600 ring-1 ring-pilot-grey-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

/**
 * TÖBB DELEGÁLT EGYMÁST ÁTFEDŐ AVATÁRKÉNT, "+N"-NEL A HATÁR FÖLÖTT.
 *
 * A Figma Szerviz / Hibajegyek terv `DelegaltAvatarStack` komponensének
 * átültetése (murena, 2026-09-24): legfeljebb `max` avatár látszik, a
 * többi egy számban. Üres listánál egy halvány gondolatjel, NEM üres hely
 * -- a hiány is állítás, lásd a ház szabályát.
 */
export function PilotAvatarStack({
  people,
  max = 3,
}: {
  people: readonly { userId: string; name: string }[];
  max?: number;
}) {
  if (people.length === 0)
    return <span className="text-pilot-grey-300">—</span>;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((person) => (
          <span key={person.userId} title={person.name}>
            <PilotAvatar
              initials={pilotInitials(person.name)}
              color={pilotAvatarColor(person.userId)}
              size="sm"
            />
          </span>
        ))}
      </div>
      {extra > 0 ? (
        <span className="ml-1 text-[10px] font-medium text-pilot-grey-400">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A SZÍN A `userId`-BŐL SZÁRMAZTATOTT, NEM TÁROLT ADAT. A Figma demo-adata
 * személyenként fix színt visel; nálunk a `AquariumMaintainer` típusnak
 * nincs szín mezője (lásd `@acropora/types`), és ezt a brief 4. pontja
 * szerint NEM kell kitalálni/hozzáadni -- ehelyett egy stabil, determinisztikus
 * leképezést használunk egy rögzített palettára, hogy ugyanaz a kolléga
 * mindig ugyanazt a színt kapja, adatbázis-mező nélkül.
 */
const AVATAR_PALETTE = [
  "#0b7a6e",
  "#374049",
  "#6b7583",
  "#7c5c3a",
  "#6150bd",
  "#a33145",
];

export function pilotAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

export function pilotInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function PilotAvatar({
  initials,
  color,
  size = "sm",
}: {
  initials: string;
  color: string;
  size?: "sm" | "md";
}) {
  const sz = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white ${sz}`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  );
}

/**
 * `fullWidth`/`size` -- A PÉNZTÁR (POS) FIGMA-KÖR ELSŐ HÍVÓJA (11. kör,
 * 2026-09-25), NEM DÍSZ. A Figma terv `Btn` micro-komponense `fullWidth`
 * és `size="lg"` propot kap a "Fizetés" gombra -- tablet-en, nagy
 * érintési felület, a leírás kifejezett kérése ("large touch targets").
 * Eddig egyik pilot oldal sem kért ezt, ezért a komponens nem hordozta;
 * mindkét prop OPCIONÁLIS és alapértelmezettje a régi viselkedés
 * (`inline-flex`, `px-3.5 py-1.5`), tehát a meglévő 20+ hívóhely
 * változatlanul fordul és fest.
 */
export function PilotButton({
  children,
  variant = "primary",
  onClick,
  type = "button",
  disabled,
  fullWidth = false,
  size = "md",
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
  "aria-expanded": ariaExpanded,
  "aria-controls": ariaControls,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "md" | "lg" | "action" | "regular";
  /** ADDITÍV: a súgó, pl. hogy egy letiltott gomb miért nem nyomható. */
  title?: string;
  /**
   * ISMETLODO GOMBOKHOZ (pl. soronkenti "Torles"), ahol a lathato felirat
   * onmagaban nem mondja meg, MELYIK sorra vonatkozik -- ugyanaz az igeny,
   * ami a `PilotInput` sajat `aria-label` propjat is indokolta.
   */
  "aria-label"?: string;
  /**
   * ADDITÍV: a kapcsoló-gombhoz (szűrő, amelyik be van nyomva). Elhagyva a
   * gomb attribútum nélkül marad, mint eddig.
   */
  "aria-pressed"?: boolean;
  /** ADDITÍV: a lenyitó gombhoz (pl. „Továbbiak”), és hogy mit nyit. Elhagyva a gomb attribútum nélkül marad. */
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  const base = `inline-flex items-center justify-center gap-1.5 rounded-md transition-all duration-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${fullWidth ? "w-full" : ""}`;
  /*
    AZ `action` ÉS A `regular` A DIRECTION F GOMBJA (Balázs Beszerzés-briefje,
    2026-09-30, 4. pont): 32 és 40 px magas, a szélessége a felirat plusz a
    vízszintes belső margó, a felirat mindkét irányban középen, és a gomb nem
    törik és nem zsugorodik (egy hosszú magyar felirat, pl. "Projekt
    hozzáadása", így sosem lóg ki és sosem vágódik). Fix szélesség nincs.
    Az `md` és az `lg` a régi pilot oldalaké, változatlanul.
  */
  const sizes = {
    md: "px-3.5 py-1.5 text-sm font-medium",
    lg: "px-5 py-3.5 text-base font-medium",
    action:
      "h-8 shrink-0 whitespace-nowrap px-3 text-sm font-semibold leading-none",
    regular:
      "h-10 shrink-0 whitespace-nowrap px-4 text-sm font-semibold leading-none",
  };
  const variants = {
    primary:
      "bg-pilot-aqua-600 text-white hover:bg-pilot-aqua-700 active:bg-pilot-aqua-800",
    secondary: `bg-white ${
      size === "action" || size === "regular"
        ? "text-pilot-grey-900"
        : "text-pilot-grey-700"
    } ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50 active:bg-pilot-grey-100`,
    /*
      A `bg-transparent` NEM DISZ (megelozo javitas, 2026-09-25, lasd
      `apps/partner/src/components/ticket-list.tsx` azonos komment
      fejleceet): a `hover:`-only osztaly nyugalmi allapotban nem ad
      `background-color`-t, es a partner portal `globals.css`-eben egy
      regi, `@layer base`-be tett szabaly (`button { background: #4c397f
      }`) MARADNA az egyetlen forras, ha nem lenne versengo osztaly. Ma
      egyik hivohely sem hasznalja a `ghost` valtozatot a partner
      portalon (mert nem hasznalna, meg nem hibazna) -- ez megelozo
      javitas, mielott valaki hasznalna.
    */
    ghost:
      "bg-transparent text-pilot-grey-500 hover:bg-pilot-grey-100 hover:text-pilot-grey-900",
    danger: "bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50",
  };
  return (
    <button
      type={type}
      className={`${base} ${sizes[size]} ${variants[variant]}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      title={title}
    >
      {children}
    </button>
  );
}

export function PilotSegmentedControl({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-pilot-grey-100 p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`cursor-pointer rounded px-3 py-1 text-sm font-medium transition-all duration-100 ${
            value === opt
              ? "bg-white text-pilot-grey-900 shadow-sm"
              : /*
                  MEGELOZO JAVITAS, 2026-09-25 -- lasd a `PilotButton`
                  "ghost" valtozatanak azonos megjegyzeset: `bg-transparent`
                  kell, kulonben a partner portal regi, `@layer base`-be
                  tett `button { background: #4c397f }` szabalya maradna
                  az egyetlen forras. Ma csak az `apps/web` hasznalja ezt a
                  komponenst, ahol ez a szabaly nem letezik -- de a
                  komponens megosztott, tehat a partner portal barmely
                  jovobeli hivohelye ebbe futna bele elore nem lathato modon.
                */
                "bg-transparent text-pilot-grey-500 hover:text-pilot-grey-700"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export function PilotFormField({
  label,
  help,
  required,
  children,
  className,
  htmlFor,
  error,
}: {
  label: string;
  help?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** ADDITÍV (T1.3, a cikkszerkesztő): a címke a mező `id`-jére mutat, ugyanaz, mint a dusk `FormField`-en. */
  htmlFor?: string;
  /** ADDITÍV (T1.3, a cikkszerkesztő): a mező hibája, a súgó alatt, piros sorban. */
  error?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-pilot-grey-700"
      >
        {label}
        {required ? (
          <span className="ml-0.5 text-pilot-aqua-600">*</span>
        ) : null}
      </label>
      {children}
      {help ? <p className="text-xs text-pilot-grey-400">{help}</p> : null}
      {error ? (
        <p className="text-xs font-medium text-pilot-red-700">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * A MAGYAR DÁTUMMEZŐ (UI-áttekintés, 3. csomag): a natív `type="date"` a böngésző nyelvén ír
 * (`mm/dd/yyyy`), ezért a szöveget mi rajzoljuk (`2026. 11. 03.`, gépelés közben formázva),
 * a naptár pedig egy rejtett natív mező, amit a gomb nyit meg. KIFELÉ az ISO alak megy
 * (`2026-11-03`), tehát a hívók és a mentett adat nem változik. Hiányos vagy nem létező
 * beírásra a hívó üres értéket kap, nem egy csonka dátumot; a `min`/`max`-on kívüli, de létező
 * nap kimegy (a hívó írja rá az üzenetét), a mező viszont `aria-invalid`.
 */
export function PilotDateField({
  id,
  value,
  onChange,
  placeholder = "ÉÉÉÉ. HH. NN.",
  readOnly,
  disabled,
  className,
  "aria-label": ariaLabel,
  title,
  min,
  max,
}: {
  id?: string;
  /** ISO dátum (`2026-11-03`) vagy üres. */
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  title?: string;
  /** ISO korlátok; a naptár is, a beírás is ezeken belül marad. */
  min?: string;
  max?: string;
}) {
  const [text, setText] = useState(() => isoToHu(value));
  const picker = useRef<HTMLInputElement>(null);
  const typed = useRef<HTMLInputElement>(null);
  // A kívülről érkező érték (betöltés, nullázás) átírja a szöveget; a félig beírt szöveg
  // értéke ugyanaz az üres, mint amit már kiadtunk, tehát azt nem bántja.
  // A hívónak minden TELJES, létező nap kimegy, a tartományon kívüli is (a natív mező is ezt
  // tette): a hívó a saját üzenetét írja rá ("nem lehet a jövőben"). A mező ettől még jelölt.
  const emitted = (shown: string) => huToIso(shown) ?? "";
  // Az átírás RENDER KÖZBEN történik (nem effektben): a hívó új értékével ugyanabban a
  // renderben a szöveg is kész, tehát nincs egy kirajzolt, elavult köztes állapot.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if ((value ?? "") !== emitted(text)) setText(isoToHu(value));
  }
  const shownIso = emitted(text);
  const invalid =
    text !== "" && (shownIso === "" || !inRange(shownIso, min, max));
  const classes = splitWidthClasses(className);
  return (
    <span className={`relative block ${classes.widthClass}`}>
      <input
        ref={typed}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        readOnly={readOnly}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={title}
        onChange={(event) => {
          const next = nextText(text, event.target.value);
          setText(next);
          onChange?.(emitted(next));
        }}
        className={`w-full rounded-md py-1.5 pl-3 pr-9 text-sm tabular-nums text-pilot-grey-900 ring-1 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500 disabled:cursor-not-allowed disabled:bg-pilot-grey-50 disabled:text-pilot-grey-400 ${
          invalid ? "ring-red-400" : "ring-pilot-grey-200"
        } ${readOnly ? "bg-pilot-grey-50 text-pilot-grey-400" : "bg-white"} ${classes.rest}`}
      />
      {readOnly || disabled ? null : (
        <>
          {/*
            A NAPTÁR A GOMBRA NYÍLIK (`showPicker`), a rejtett natív mező csak a választást adja.
            Az átlátszó natív mező a gomb FÖLÖTT nem jó: az asztali Chrome a date mezőre
            kattintva csak a saját ikonján nyit naptárat, máshol a szegmensbe teszi a fókuszt.
            Ahol nincs `showPicker`, a fókusz a szöveges mezőben marad, ott a nap beírható.
          */}
          <button
            type="button"
            aria-label="Naptár megnyitása"
            onClick={() => {
              const native = picker.current;
              if (native && typeof native.showPicker === "function") {
                try {
                  native.showPicker();
                  return;
                } catch {
                  // A böngésző megtagadta (pl. nincs felhasználói művelet): marad a beírás.
                }
              }
              typed.current?.focus();
            }}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-pilot-grey-500 hover:text-pilot-grey-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilot-aqua-500"
          >
            <Icon name="calendar" size={16} />
          </button>
          <input
            ref={picker}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            value={value ?? ""}
            min={min}
            max={max}
            onChange={(event) => {
              setText(isoToHu(event.target.value));
              onChange?.(event.target.value);
            }}
            className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
          />
        </>
      )}
    </span>
  );
}

export function PilotInput({
  id,
  leadingIcon,
  value,
  onChange,
  type = "text",
  placeholder,
  readOnly,
  disabled,
  className,
  "aria-label": ariaLabel,
  title,
  inputMode,
  min,
  max,
  maxLength,
  required,
  step,
  "aria-invalid": ariaInvalid,
}: {
  value?: string;
  onChange?: (value: string) => void;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** NATÍV TOOLTIP, pl. miért tiltott épp ez a mező -- ugyanaz az igény,
   * ami a `worksheet-line-editor.tsx` "Hányan" mezőjét indokolta. */
  title?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  /**
   * `min`/`max` A NATÍV RANGE-KORLÁTOZOTT INPUT-TÍPUSOKHOZ (`date`, `time`,
   * `datetime-local`, `number`) -- nem stílus, hanem a böngésző saját
   * korlátozása, ezért külön propok, nem a `className`-en keresztül.
   * `number | string`, mert a `type="number"` mezők számot, a
   * `type="datetime-local"` mezők ISO-szerű szöveget várnak ide.
   */
  min?: number | string;
  max?: number | string;
  /** ADDITÍV (T1.3, a márka SEO-mezői): a natív hosszkorlát, ugyanaz, mint a dusk `Input`-on. */
  maxLength?: number;
  /** ADDITÍV (T1.3, a tartalom felvétele): a natív kötelező jelölés, ugyanaz, mint a dusk `Input`-on. */
  required?: boolean;
  /**
   * ADDITÍV (T1.3, a beszerzési számla): a szám-mező lépésköze. A `step="any"` nélkül a natív űrlap-ellenőrzés
   * a tizedes árfolyamot (`395.12`) érvénytelennek veszi, és a beküldés elakad.
   */
  step?: number | "any";
  /** ADDITÍV (T1.3, a beszerzési számla): a hibás mező jelölése, ugyanaz a piros keret, mint a `PilotDateField`-en. */
  "aria-invalid"?: boolean;
  /** ADDITÍV (Direction F, 2026-09-30): egy külső `<label htmlFor>`-hoz. */
  id?: string;
  /** ADDITÍV: ikon a mező elején (a terv keresőmezője). */
  leadingIcon?: ReactNode;
}) {
  // A dátummező magyar alakban jelenik meg (a natív mező a böngésző nyelvén írna).
  if (type === "date" && !leadingIcon) {
    return (
      <PilotDateField
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
        title={title}
        min={typeof min === "string" ? min : undefined}
        max={typeof max === "string" ? max : undefined}
      />
    );
  }
  const classes = splitWidthClasses(className);
  const input = (
    <input
      id={id}
      type={type}
      placeholder={placeholder}
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      inputMode={inputMode}
      min={min}
      max={max}
      maxLength={maxLength}
      required={required}
      step={step}
      aria-invalid={ariaInvalid || undefined}
      onChange={(event) => onChange?.(event.target.value)}
      className={`${leadingIcon ? "w-full" : classes.widthClass} rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ${
        ariaInvalid ? "ring-red-400" : "ring-pilot-grey-200"
      } placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500 disabled:cursor-not-allowed disabled:bg-pilot-grey-50 disabled:text-pilot-grey-400 ${
        readOnly ? "bg-pilot-grey-50 text-pilot-grey-400" : "bg-white"
      } ${leadingIcon ? "pl-9" : ""} ${classes.rest}`}
    />
  );
  if (!leadingIcon) return input;
  return (
    <div className={`relative ${classes.widthClass}`}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-500">
        {leadingIcon}
      </span>
      {input}
    </div>
  );
}

export function PilotSelect({
  children,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  id,
  className,
  chevron,
  required,
}: {
  children: ReactNode;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** ADDITÍV (T1.3, a tartalom felvétele): a natív kötelező jelölés, ugyanaz, mint a dusk `Select`-en. */
  required?: boolean;
  "aria-label"?: string;
  /** ADDITÍV (Direction F, 2026-09-30): egy külső `<label htmlFor>`-hoz. */
  id?: string;
  /** ADDITÍV: méret a hívó sorához (pl. a lapméret-választó szélessége). */
  className?: string;
  /**
   * A LENYÍLÓ NYÍL. ALAPBÓL KIRAJZOLJA (UI-áttekintés, 2026-11-03): a `appearance-none` elrejti a böngésző
   * nyilát, és nyíl nélkül a választó beviteli mezőnek látszott (a /szerviz/eszkozok/uj hat választója). Az
   * alap ilyenkor a teljes szélességet tölti (`w-full`, mint a régi nyíl nélküli alak). `chevron` kifejezetten
   * `true`: a régi nyilas alak, burkoló szélesség nélkül (a hívó méretezi); `false`: nyíl nélkül.
   */
  chevron?: boolean;
}) {
  const drawArrow = chevron !== false;
  const select = (
    <select
      id={id}
      value={value}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      onChange={(event) => onChange?.(event.target.value)}
      className={`w-full cursor-pointer appearance-none rounded-md bg-white px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500 disabled:cursor-not-allowed disabled:bg-pilot-grey-50 disabled:text-pilot-grey-400 ${
        drawArrow ? "pr-9" : (className ?? "")
      }`}
    >
      {children}
    </select>
  );
  if (!drawArrow) return select;
  return (
    <div
      className={`relative ${className ?? (chevron === undefined ? "w-full" : "")}`}
    >
      {select}
      <Icon
        name="chevron-down"
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-pilot-grey-500"
      />
    </div>
  );
}

export function PilotCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-white ring-1 ring-pilot-grey-200 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * `icon` OPCIONÁLIS, ADDITÍV MEZŐ (2026-09-25, webes kezdőlap Figma-
 * igazítás) -- a meglévő hívók (aquárium/hibajegy/eszköz/munkalap pilot
 * lapok, sok tucat helyen) `icon` nélkül hívnak, és a hiányában a fejléc
 * BETŰRE ugyanazt rajzolja, mint korábban: a prop csak akkor foglal helyet,
 * ha meg van adva. A hívó adja át a kész `<Icon .../>`-t (méret, szín a
 * hívóé), ugyanaz a minta, mint az `action`-nél -- ez a komponens nem dönt
 * ikon-névről vagy színről, csak helyet ad neki a cím elé.
 *
 * AZ IKON A `<h3>`-ON BELÜL ÁLL, NEM EGY ÚJ KÜLSŐ `<div>`-BEN -- ez nem
 * ízlés kérdése: több meglévő teszt (pl. `worksheet-documents.component.
 * test.tsx` `szakasz()` segédje) a cím szövegétől KÉT SZINTET lép felfelé
 * (`fejlec.parentElement.parentElement`) a kártya-panel eléréséhez. Egy
 * köztes `<div>` az ikon és a `<h3>` köré ezt a feltevést törte volna (a két
 * lépés akkor a fejléc-sorra, nem a kártyára ért volna) -- mérve, a teljes
 * webes tesztsor futtatásával derült ki. Az ikon így NEM változtatja meg a
 * `<h3>` mélységét a szülőhöz képest, csak a saját tartalmát bővíti.
 */
export function PilotCardHeader({
  title,
  icon,
  action,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-pilot-grey-100 px-5 py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-pilot-grey-900">
        {icon}
        {title}
      </h3>
      {action}
    </div>
  );
}

/**
 * A JOBB OLDALI FIÓK. A Direction F Számlázás-terve (Figma 316:1485, az
 * e-mail szerkesztő) óta bővítve, ADDITÍVAN: a régi hívó (akvárium
 * vízértékek) a `title`/`children` alakban változatlanul működik.
 *
 * - Valódi párbeszédablak: `role="dialog"`, `aria-modal`, a cím a neve.
 * - Escape-re és a háttérre kattintva zár; a bezáró gomb neve "Bezárás".
 * - Zárt állapotban a tartalma `inert` és `aria-hidden`: nem érhető el sem
 *   billentyűzettel, sem képernyőolvasóval, csak ki van tolva a képből.
 * - `subtitle`, `footer` (a lap alján álló, nem görgő sáv a gombokkal) és
 *   `width` (`md` a régi 448, `lg` a terv 520 pixele, `xl` 640 pixel: Balázs
 *   a stage-en a számlázás 520-as paneljét keskenynek találta, 2026-09-30).
 *   Az alapértelmezés `md` marad: a partner-portál vízértékei nem változnak.
 * - A törzs belső margóját a hívó adja (az akvárium `px-6 py-5`-tel).
 */
const DRAWER_WIDTHS = {
  md: "max-w-md",
  lg: "max-w-[520px]",
  xl: "max-w-[640px]",
} as const;

export function PilotDrawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg" | "xl";
  children: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-pilot-grey-900/20 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      {/*
        A ZÁRT FIÓK NEM LÁTSZIK, ÉS SEMMI NEM LÓG KI BELŐLE (UI 1. csomag, 2026-11-03, a stage-képeken a jobb szélen
        szürke csík): a képernyőn kívülre csúsztatott panel árnyéka (shadow-2xl) eddig visszanyúlt a lapra. Most a
        panel egy képernyőt kitöltő, vágó tárolóban áll, és csukva `invisible`: a láthatóság a csúszás végén vált,
        tehát a kinyitás és a becsukás animációja megmarad. Mérve böngészőben: a jobb szél pixele 226 helyett a
        háttér 246-a.
      */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-hidden={!open}
          inert={!open}
          className={`pointer-events-auto absolute right-0 top-0 flex h-full w-full ${
            DRAWER_WIDTHS[width]
          } flex-col bg-white transition-[transform,visibility,box-shadow] duration-250 ease-in-out ${
            open
              ? "visible translate-x-0 shadow-2xl"
              : "invisible translate-x-full shadow-none"
          }`}
        >
          <div className="flex items-start justify-between gap-3 border-b border-pilot-grey-100 px-6 py-4">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-base font-semibold text-pilot-grey-900"
              >
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-0.5 text-xs text-pilot-grey-500">{subtitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Bezárás"
              className="shrink-0 cursor-pointer rounded-md p-1.5 text-pilot-grey-400 transition hover:bg-pilot-grey-100 hover:text-pilot-grey-700"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
          {children}
          {footer ? (
            <div className="border-t border-pilot-grey-100 px-6 py-4">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function PilotDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-pilot-grey-900/30 p-4 transition-opacity duration-150 ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * EGY CÍMKE+ÉRTÉK SOR, A FIGMA PARTNER PORTÁL ADATLAPJAINAK OLDALSÁVJÁHOZ
 * (`PartnerPortalScreen.tsx` `DataRow`, 308-315. sor). ELSŐ HASZNÁLAT: a
 * hibajegy-adatlap "Az ügy adatai" panelje, MÁSODIK a tervezett eszköz- és
 * munkalap-adatlap saját adatsora -- innentől közös, nem app-szintű.
 *
 * A HIÁNYZÓ ÉRTÉK MINDIG "Nincs megadva" SZÖVEG, SOSEM ÜRES CELLA -- ezt a
 * komponens maga kényszeríti ki (`value || <span>Nincs megadva</span>`), a
 * hívónak nem kell külön esetet írnia rá.
 */
export function PilotDataRow({
  label,
  value,
  labelWidth,
}: {
  label: string;
  value?: ReactNode;
  labelWidth?: string;
}) {
  return (
    <div
      className="grid gap-4 border-b border-pilot-grey-50 py-2.5 last:border-0"
      style={{ gridTemplateColumns: `${labelWidth ?? "180px"} 1fr` }}
    >
      <span className="text-xs font-medium text-pilot-grey-400">{label}</span>
      <span className="text-sm text-pilot-grey-700">
        {value || (
          <span className="italic text-pilot-grey-300">Nincs megadva</span>
        )}
      </span>
    </div>
  );
}

/**
 * PÖTTYÖS-VONALAS IDŐVONAL, A FIGMA PARTNER PORTÁL ADATLAPJAINAK "MI
 * TÖRTÉNT" PANELJÉHEZ (`PartnerPortalScreen.tsx` `Timeline`, 317-337. sor).
 *
 * PREZENTÁCIÓS KOMPONENS, NEM DOMAIN-SPECIFIKUS: a hívó alakítja át a saját
 * (jegy-napló, munkalap-verzió stb.) adatát `text`/`meta` párrá -- a
 * hibajegy naplója és egy jövőbeli eszköz-előzmény teljesen más alakú
 * bemenetből épül, csak a MEGJELENÉS közös.
 */
export function PilotTimeline({
  items,
}: {
  items: readonly { key: string; text: ReactNode; meta?: ReactNode }[];
}) {
  return (
    <div className="flex flex-col">
      {items.map((item, index) => (
        <div
          key={item.key}
          className="flex gap-3 border-b border-pilot-grey-50 py-3 last:border-0"
        >
          <div className="flex flex-col items-center gap-1 pt-0.5">
            <div className="h-2 w-2 shrink-0 rounded-full bg-pilot-aqua-500" />
            {index < items.length - 1 ? (
              <div className="min-h-[16px] w-px flex-1 bg-pilot-grey-100" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <p className="text-sm text-pilot-grey-700">{item.text}</p>
            {item.meta ? (
              <div className="mt-1 text-xs text-pilot-grey-400">
                {item.meta}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A MAGYAR FÁJLMEZŐ (UI-áttekintés, 3. csomag): a natív `<input type="file">` a böngésző nyelvén
 * ír ("Choose File  No file chosen"). Ez egy gomb ("Fájl kiválasztása") és a választott fájl
 * neve, a valódi mező mögötte rejtett. DROP-IN: a natív mező tulajdonságait veszi át
 * (`accept`, `multiple`, `disabled`, `onChange`, `aria-label`, `ref`...), a hívó ugyanúgy
 * `event.target.files`-ból olvas. A mező a billentyűzetnek a GOMB (a rejtett mező kimarad a
 * tab-sorból), a felolvasónak "<felirat>: fájl kiválasztása".
 */
export function PilotFileInput({
  className,
  onChange,
  multiple,
  disabled,
  "aria-label": ariaLabel,
  ref,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  /** A hívó elérheti a valódi mezőt (`ref.current.files`, `ref.current.value = ""`). */
  ref?: Ref<HTMLInputElement>;
}) {
  const field = useRef<HTMLInputElement | null>(null);
  const [names, setNames] = useState<string[]>([]);
  // A hívó a mezőt programmal is kiürítheti (`ref.current.value = ""`), esemény nélkül: minden
  // renderelés után a valódi mezőhöz igazodik a kiírt név, és csak eltérésnél állít állapotot.
  useEffect(() => {
    const actual = Array.from(field.current?.files ?? []).map((f) => f.name);
    setNames((current) =>
      current.join("\n") === actual.join("\n") ? current : actual,
    );
  });
  const label = multiple ? "Fájlok kiválasztása" : "Fájl kiválasztása";
  const shown =
    names.length === 0
      ? "Nincs kiválasztott fájl"
      : names.length <= 2
        ? names.join(", ")
        : `${names.length} fájl`;
  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center gap-2 align-middle ${className ?? ""}`}
    >
      <input
        {...rest}
        ref={(node) => {
          field.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        type="file"
        multiple={multiple}
        disabled={disabled}
        aria-label={ariaLabel}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []).map(
            (f) => f.name,
          );
          onChange?.(event);
          // A hívó a fogyasztott fájl után gyakran kiüríti a mezőt (`value = ""`): ilyenkor
          // nincs mit mutatni, nem marad ott a már feltöltött fájl neve.
          setNames(event.target.value === "" ? [] : chosen);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={
          ariaLabel ? `${ariaLabel}: ${label.toLowerCase()}` : undefined
        }
        onClick={() => field.current?.click()}
        className="inline-flex h-8 shrink-0 items-center rounded-md bg-white px-3 text-sm font-medium text-pilot-grey-800 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilot-aqua-500 disabled:cursor-not-allowed disabled:text-pilot-grey-400"
      >
        {label}
      </button>
      <span className="truncate text-xs text-pilot-grey-500">{shown}</span>
    </span>
  );
}

/**
 * A MAGYAR HÓNAPVÁLASZTÓ (UI-áttekintés, 3. csomag, 2026-11-03). A natív `<input type="month">`
 * a böngésző nyelvén ír ("August 2026"), ezért két választó adja: az év és a hónap magyar neve.
 * Kifelé az `ÉÉÉÉ-HH` érték megy (mint a natív mezőnél), tehát a hívók értéke nem változik.
 *
 * FÉLKÉSZ VÁLASZTÁS NEM MEGY KI: ha csak az év vagy csak a hónap van kiválasztva, a hívó üres
 * értéket kap, a mező viszont megtartja a kiválasztott felet, hogy a másik is megadható legyen.
 * A két választó neve `<címke>, év` és `<címke>, hónap`, a csoporté a címke.
 */
export function PilotMonthField({
  value,
  onChange,
  "aria-label": ariaLabel = "Hónap",
  className,
  now,
}: {
  value: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
  className?: string;
  /** Csak a tesztnek: az "idei év" forrása. */
  now?: Date;
}) {
  const parts = monthParts(value);
  const [pending, setPending] = useState({ year: "", month: "" });
  // Egy érvényes érték vezérel; üres értéknél csak a FÉLIG kiválasztott fél marad meg. Egy teljes
  // pending üres érték mellett azt jelenti, hogy a hívó kívülről törölte az értéket (például egy
  // szűrő-alaphelyzet): azt nem mutatjuk, különben a mező mást mondana, mint az érték.
  const half =
    joinMonth(pending.year, pending.month) === ""
      ? pending
      : { year: "", month: "" };
  const year = value ? parts.year : half.year;
  const month = value ? parts.month : half.month;
  const years = monthYears((now ?? new Date()).getFullYear(), year);
  const pick = (nextYear: string, nextMonth: string) => {
    setPending({ year: nextYear, month: nextMonth });
    onChange(joinMonth(nextYear, nextMonth));
  };
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex items-center gap-2 ${className ?? ""}`}
    >
      <PilotSelect
        chevron
        aria-label={`${ariaLabel}, év`}
        className="w-28"
        value={year}
        onChange={(next) => pick(next, month)}
      >
        <option value="">Év</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </PilotSelect>
      <PilotSelect
        chevron
        aria-label={`${ariaLabel}, hónap`}
        className="w-40"
        value={month}
        onChange={(next) => pick(year, next)}
      >
        <option value="">Hónap</option>
        {HU_MONTHS.map((_, index) => {
          const number = String(index + 1).padStart(2, "0");
          return (
            <option key={number} value={number}>
              {monthName(number)}
            </option>
          );
        })}
      </PilotSelect>
    </div>
  );
}

/**
 * A HÍVÓ SZÉLESSÉGE FELÜLÍRJA AZ ALAP `w-full`-T (UI-áttekintés, 2026-11-03). A beviteli mező `w-full`-t visel, és a hívó
 * `className`-je ugyanarra az elemre kerül: ha az is szélességet ad (`w-20`, `w-[150px]`), a kettő közül a CSS
 * sorrendje dönt, nem az osztályok sorrendje (a `cn` itt sima összefűzés). Az eredmény: a "Tól / Ig" mezők soronként
 * más szélességűek lettek, a dátumszűrők teljes szélességűek maradtak. A szélesség-osztályokat (`w-*`, változattal is;
 * a `min-w-*` és `max-w-*` nem) ezért külön vesszük: ahol van VÁLTOZAT NÉLKÜLI szélesség, ott nincs alap `w-full`; egy
 * csak változatos (`md:w-40`) mellett marad, hogy a mező telefonon teljes szélességű legyen. A szélesség az ikonos
 * mező burkolójára kerül (az input kitölti).
 */
export function splitWidthClasses(className: string | undefined): {
  /** A szélesség-osztályok (változatosak is). */
  width: string;
  /** A többi osztály. */
  rest: string;
  /** Van-e változat NÉLKÜLI szélesség (`w-20`): csak az váltja ki az alap `w-full`-t. */
  hasBase: boolean;
  /** A szélesség-osztályok az alap `w-full`-lal, ha nincs változat nélküli szélesség (a `md:w-40` telefonon nem veszi el a teljes szélességet). */
  widthClass: string;
} {
  const tokens = (className ?? "").split(/\s+/).filter(Boolean);
  const isWidth = (token: string) => /^(?:[\w-]+:)*w-/.test(token);
  const width = tokens.filter(isWidth).join(" ");
  const hasBase = tokens.some((token) => /^w-/.test(token));
  return {
    width,
    rest: tokens.filter((token) => !isWidth(token)).join(" "),
    hasBase,
    widthClass: hasBase ? width : `w-full ${width}`.trim(),
  };
}
