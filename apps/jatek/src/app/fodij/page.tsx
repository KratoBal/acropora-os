import type { Metadata } from "next";

import { FodijOldal } from "@/components/fodij-oldal";
import { OldalKeret } from "@/components/oldal-keret";

import "../fodij.css";

export const metadata: Metadata = {
  title: "AF Nano Tank, a fődíj",
  description:
    "Az Acropora nyereményjáték fődíja: az Aquaforest AF Nano Tank, teljes zátonyakvárium-készlet.",
};

export default function FodijLap() {
  return (
    <OldalKeret>
      <FodijOldal />
    </OldalKeret>
  );
}
