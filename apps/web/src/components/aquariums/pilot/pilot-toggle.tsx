"use client";
import { Button } from "@acropora/ui";
import { type ReactNode, useState } from "react";

/**
 * A MAI ÉS AZ ÚJ NÉZET EGYMÁS MELLETT VÁLASZTHATÓ -- Balázs és acrobot
 * megállapodása (2026-09-24 15:44): "egy felületen kezdünk, egymás mellé
 * tesszük, és ha tetszik, onnan megy a többire." Egy teljes akvárium-tábla
 * vagy űrlap két hasábban nem fér el olvashatóan, ezért a "mellé tesszük"
 * itt egy azonnali VÁLTÓ -- ugyanaz a döntés, mint a Figma App.tsx saját
 * "Desktop/Mobile" kapcsolója.
 *
 * ALAPÉRTELMEZETT A "MAI" NÉZET: a brief 1. pontja szerint "a többi oldal
 * NEM változik" -- ez a lap se változzon annak, aki nem keresi a
 * kísérletet. A kapcsoló maga a `@acropora/ui` `Button`-ját használja
 * (nem a pilot-primitíveket), hogy MINDIG ugyanúgy nézzen ki, függetlenül
 * attól, melyik nézet aktív.
 */
export function PilotToggle({
  legacy,
  pilot,
}: {
  legacy: ReactNode;
  pilot: ReactNode;
}) {
  const [active, setActive] = useState<"legacy" | "pilot">("legacy");
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button
          type="button"
          variant={active === "legacy" ? "primary" : "secondary"}
          onClick={() => setActive("legacy")}
        >
          Mai felület
        </Button>
        <Button
          type="button"
          variant={active === "pilot" ? "primary" : "secondary"}
          onClick={() => setActive("pilot")}
        >
          Kísérleti terv (Figma)
        </Button>
      </div>
      {active === "legacy" ? legacy : pilot}
    </div>
  );
}
