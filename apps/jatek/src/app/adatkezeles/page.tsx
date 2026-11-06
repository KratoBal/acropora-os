import type { Metadata } from "next";

import { JogiOldal } from "@/components/jogi-oldal";
import { OldalKeret } from "@/components/oldal-keret";
import { ADATKEZELES } from "@/lib/jogi-szovegek";

export const metadata: Metadata = { title: "Adatkezelési tájékoztató" };

export default function AdatkezelesLap() {
  return (
    <OldalKeret>
      <JogiOldal dokumentum={ADATKEZELES} />
    </OldalKeret>
  );
}
