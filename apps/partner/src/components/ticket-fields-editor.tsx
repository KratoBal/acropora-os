"use client";

import { useState } from "react";
import { PilotButton, PilotFormField, PilotInput } from "@acropora/ui";

import { partnerApi } from "@/lib/api";

/**
 * A BEJELENTO JAVITHATJA A SAJAT BEJELENTESET.
 *
 * Balazs kerese, 2026-09-22, a sajat peldajaval: „Most is van egy eles
 * hibajegy aminek elirta a cimet. En se tudom modositani".
 *
 * === A PARTNER HATARA MAS, MINT A BELSOSE ===
 *
 * A belsos kollega a jegy LEZARASAIG szerkeszthet; a partner addig, amig a
 * jegyen NINCS munkalap. Amint elindult a munka, a bejelentes szovege ahhoz a
 * munkahoz tartozik, es nem valtozhat a hata mogott.
 *
 * A LAP A SAJAT IDOVONALABOL DONTI EL, hogy latszik-e a szerkeszto -- de a
 * SZERVER dont. Egy REJTETT munkalap a partner idovonalan nem jelenik meg, a
 * szerver viszont szamolja: ilyenkor a gomb latszik, a mentes pedig a szerver
 * mondataval all meg. Ez a helyes sorrend -- a rejtes nem szivarogtathat ki
 * azzal, hogy egy gomb eltunik.
 */
export function TicketFieldsEditor({
  ticketId,
  title,
  description,
  onSaved,
}: {
  ticketId: string;
  title: string;
  description: string | null;
  onSaved: () => void | Promise<void>;
}) {
  const [nyitva, setNyitva] = useState(false);
  const [cim, setCim] = useState(title);
  const [leiras, setLeiras] = useState(description ?? "");
  const [ment, setMent] = useState(false);
  const [hiba, setHiba] = useState<string | null>(null);

  const kezdes = () => {
    // A MAI ERTEKROL indulunk, nem az elso betoltesrol: kozben mas is irhatta.
    setCim(title);
    setLeiras(description ?? "");
    setHiba(null);
    setNyitva(true);
  };

  const mentes = async () => {
    setMent(true);
    setHiba(null);
    try {
      await partnerApi.updateTicket(ticketId, {
        title: cim.trim(),
        // A "nincs leiras" allapot a semaban `null`, nem ures szoveg.
        description: leiras.trim() === "" ? null : leiras.trim(),
      });
      setNyitva(false);
      await onSaved();
    } catch (cause) {
      // A SZERVER MONDATA MEGY KI: az mondja meg, MIERT nem lehet.
      setHiba(
        cause instanceof Error
          ? cause.message
          : "A bejelentés nem módosítható.",
      );
    } finally {
      setMent(false);
    }
  };

  if (!nyitva)
    return (
      <PilotButton variant="secondary" onClick={kezdes}>
        Bejelentés javítása
      </PilotButton>
    );

  return (
    /*
      NINCS SAJAT KULSO PANEL/KERET: ez a komponens MINDIG egy MAR pilot-aqua
      `PilotCard` tartalmaban all (lasd `ticket-detail.tsx`), tehat egy sajat
      `PANEL` (regi, feher/`bg-white` keret) csak beagyazott, feleslegesen
      duplazott dobozt adna -- es a `PANEL` sajat `border-[#e2e2ea]` szine
      raw hex, sotet modban nem valtana.
    */
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-pilot-grey-900">
        A bejelentés javítása
      </h3>
      {hiba ? (
        <p role="alert" className="text-sm leading-relaxed text-pilot-red-700">
          {hiba}
        </p>
      ) : null}
      <PilotFormField label="Mi a probléma?">
        {/*
          A `PilotInput`-nak NINCS `maxLength` propja (lasd `pilot-ui.tsx`),
          ugyanaz a hianyossag, mint a `settings.tsx` alairokod-mezojenel --
          a 300 karakteres korlatot ezert az `onChange` kenyszeriti ki, nem
          a natv attributum.
        */}
        <PilotInput
          aria-label="A bejelentés címe"
          value={cim}
          onChange={(value) => setCim(value.slice(0, 300))}
        />
      </PilotFormField>
      <PilotFormField label="Részletes leírás">
        {/*
          NINCS `PilotTextarea`: a keszlet ma csak `PilotInput`-ot ad
          (lasd `pilot-ui.tsx`), tobbsoros mezot senki nem kert meg eddig.
          A sotet szin/hatter ITT IS a globalis
          `[data-theme="dark"] textarea { ... !important }` szabalybol jon
          (lasd `figma-theme.css`), a `PilotInput`-eval megegyezo keret- es
          teravlaszto osztalyok csak a VILAGOS modot es a fokuszt adjak.
        */}
        <textarea
          aria-label="A bejelentés leírása"
          value={leiras}
          rows={6}
          maxLength={4000}
          onChange={(event) => setLeiras(event.target.value)}
          className="w-full rounded-md bg-white px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        />
      </PilotFormField>
      <div className="flex justify-end gap-2">
        <PilotButton
          variant="secondary"
          disabled={ment}
          onClick={() => setNyitva(false)}
        >
          Mégsem
        </PilotButton>
        {/*
          URES CIMMEL NEM INDUL: a cim a semaban KOTELEZO, tehat biztos
          elutasitas. Egy halozati kor arra, amirol itt is tudjuk, hogy nem
          mehet, csak varakozas a bejelentonek.
        */}
        <PilotButton
          disabled={ment || cim.trim() === ""}
          onClick={() => void mentes()}
        >
          {ment ? "Mentés…" : "Mentés"}
        </PilotButton>
      </div>
    </div>
  );
}
