import type { Metadata } from "next";

import { JogiOldal } from "@/components/jogi-oldal";
import { OldalKeret } from "@/components/oldal-keret";
import { JATEKSZABALYZAT } from "@/lib/jogi-szovegek";

export const metadata: Metadata = { title: "Játékszabályzat" };

export default function JatekszabalyzatLap() {
  return (
    <OldalKeret>
      <JogiOldal dokumentum={JATEKSZABALYZAT} />
    </OldalKeret>
  );
}
