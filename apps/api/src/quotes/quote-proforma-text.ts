import { trimPercentText } from "@acropora/types";

/**
 * A MÉRFÖLDKŐ DÍJBEKÉRŐJÉNEK SZÖVEGEI (task t-20261117-dijbekero-szazalek): a tétel leírása és a bizonylat megjegyzése. A százalék a
 * mérföldkő pontos értékéből jön; a felirat nulla nélküli alakját a közös `trimPercentText` adja (a tizedespont nélküli „60” nulláját
 * nem vágja le: Luca 2026-11-17-én „Előleg megrendeléskor (6%)” feliratot kapott a 60% helyett).
 *
 * AZ ÖSSZEG NEM ITT SZÁMOLÓDIK: azt az `allocateMilestone` adja a mérföldkő pontos `Decimal` százalékából, a felirat szövegétől független.
 */
export function proformaLineDescription(input: {
  label: string;
  percent: { toString(): string };
  quoteNumber: string;
}): string {
  return `${input.label} (${trimPercentText(input.percent.toString())}%), ${input.quoteNumber}`;
}

export function proformaNote(input: {
  label: string;
  percent: { toString(): string };
  quoteNumber: string;
}): string {
  return `${input.label} (${trimPercentText(input.percent.toString())}%) a(z) ${input.quoteNumber} ajánlathoz.`;
}
