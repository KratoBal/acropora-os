/**
 * A PARTNER-LISTÁK TELEFONOS KÁRTYA-ALAKJA (picasso képernyő-leltár, 4. pont, P2; acrobot 62272): ugyanaz a `<table>`, csak `md` alatt
 * blokk-elrendezésre vált, mint a hibajegy-lista (#2859) és a közös `PilotDataTable`. A sor egy kártya, az első cella a címe, a többi
 * cella a saját feliratával áll alatta (`data-label`, a fejléc szövege), a fejléc a képernyőolvasónak marad (`sr-only`).
 *
 * AZ OSZTÁLYOK IDÉZETT SZÖVEGKÉNT ÁLLNAK, nem sablon-ágban: a Tailwind a forrásszövegből szedi ki őket, és egy `...]${` szomszédság
 * mellett a nevet nem veszi ki (lásd `packages/ui/src/pilot-os.tsx`, `PHONE_LABEL_CONTENT`).
 */
export const PHONE_TITLE_CELL =
  "max-md:block max-md:p-0 max-md:pb-1 max-md:whitespace-normal";

export const PHONE_CELL =
  "max-md:flex max-md:items-baseline max-md:gap-2 max-md:p-0 max-md:py-1 max-md:text-left max-md:whitespace-normal max-md:before:shrink-0 max-md:before:text-[11px] max-md:before:font-semibold max-md:before:uppercase max-md:before:tracking-[0.05em] max-md:before:text-pilot-grey-500 max-md:before:content-[attr(data-label)]";
