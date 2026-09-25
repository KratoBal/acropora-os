"use client";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";

import { Icon } from "./icon";
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
}: {
  children?: ReactNode;
  className?: string;
  fontClassName?: string;
}) {
  const { effectiveTheme } = useThemePreference();
  return (
    <div
      data-theme={effectiveTheme}
      className={`${fontClassName} ${className}`}
    >
      {children}
    </div>
  );
}

export type PilotBadgeVariant =
  "teal" | "grey" | "amber" | "blue" | "danger" | "default";

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

export function PilotButton({
  children,
  variant = "primary",
  onClick,
  type = "button",
  disabled,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";
  const variants = {
    primary:
      "bg-pilot-aqua-600 text-white hover:bg-pilot-aqua-700 active:bg-pilot-aqua-800",
    secondary:
      "bg-white text-pilot-grey-700 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50 active:bg-pilot-grey-100",
    ghost:
      "text-pilot-grey-500 hover:bg-pilot-grey-100 hover:text-pilot-grey-900",
    danger: "bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50",
  };
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]}`}
      onClick={onClick}
      disabled={disabled}
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
              : "text-pilot-grey-500 hover:text-pilot-grey-700"
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
}: {
  label: string;
  help?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <label className="text-sm font-medium text-pilot-grey-700">
        {label}
        {required ? (
          <span className="ml-0.5 text-pilot-aqua-600">*</span>
        ) : null}
      </label>
      {children}
      {help ? <p className="text-xs text-pilot-grey-400">{help}</p> : null}
    </div>
  );
}

export function PilotInput({
  value,
  onChange,
  type = "text",
  placeholder,
  readOnly,
  disabled,
  className,
  "aria-label": ariaLabel,
  inputMode,
  min,
  max,
}: {
  value?: string;
  onChange?: (value: string) => void;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
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
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      aria-label={ariaLabel}
      inputMode={inputMode}
      min={min}
      max={max}
      onChange={(event) => onChange?.(event.target.value)}
      className={`w-full rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500 disabled:cursor-not-allowed disabled:bg-pilot-grey-50 disabled:text-pilot-grey-400 ${
        readOnly ? "bg-pilot-grey-50 text-pilot-grey-400" : "bg-white"
      } ${className ?? ""}`}
    />
  );
}

export function PilotSelect({
  children,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange?.(event.target.value)}
      className="w-full cursor-pointer appearance-none rounded-md bg-white px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500 disabled:cursor-not-allowed disabled:bg-pilot-grey-50 disabled:text-pilot-grey-400"
    >
      {children}
    </select>
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

export function PilotCardHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-pilot-grey-100 px-5 py-4">
      <h3 className="text-sm font-semibold text-pilot-grey-900">{title}</h3>
      {action}
    </div>
  );
}

export function PilotDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-pilot-grey-900/20 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-250 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-pilot-grey-100 px-6 py-4">
          <h2 className="text-base font-semibold text-pilot-grey-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md p-1.5 text-pilot-grey-400 transition hover:bg-pilot-grey-100 hover:text-pilot-grey-700"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
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
