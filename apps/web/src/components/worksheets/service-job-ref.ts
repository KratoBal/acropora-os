/**
 * A MUNKALAP "JEGY" HIVATKOZÁSA: HOVÁ VISZ, ÉS MI A FELIRATA (Balázs, 2026-11-18; acrobot 55785). A háttérben a karbantartási lap
 * ServiceJob(MAINTENANCE), de a felhasználó SEHOL nem láthatja hibajegyként: a munkalap hivatkozása a Karbantartás alatti adatlapra
 * visz, "Karbantartási lap" felirattal. A fajta nélküli (régi) válasz hibajegynek számít.
 */
export function serviceJobRef(job: {
  id: string;
  kind?: "REPAIR" | "MAINTENANCE";
}): { href: string; label: string } {
  return job.kind === "MAINTENANCE"
    ? { href: `/szerviz/karbantartas/${job.id}`, label: "Karbantartási lap" }
    : { href: `/szerviz/hibajegyek/${job.id}`, label: "Hibajegy" };
}
