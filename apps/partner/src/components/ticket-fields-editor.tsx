"use client";

import { useState } from "react";

import { partnerApi } from "@/lib/api";
import { PANEL, PANEL_CIM } from "./frame";

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
      <button type="button" className="secondary" onClick={kezdes}>
        Bejelentés javítása
      </button>
    );

  return (
    <article className={PANEL}>
      <h2 className={PANEL_CIM}>A bejelentés javítása</h2>
      {hiba ? (
        <p role="alert" className="leading-[1.5] text-[#b3261e]">
          {hiba}
        </p>
      ) : null}
      <label>
        Mi a probléma?
        <input
          aria-label="A bejelentés címe"
          value={cim}
          maxLength={300}
          onChange={(event) => setCim(event.target.value)}
        />
      </label>
      <label>
        Részletes leírás
        <textarea
          aria-label="A bejelentés leírása"
          value={leiras}
          rows={6}
          maxLength={4000}
          onChange={(event) => setLeiras(event.target.value)}
        />
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          disabled={ment}
          onClick={() => setNyitva(false)}
        >
          Mégsem
        </button>
        {/*
          URES CIMMEL NEM INDUL: a cim a semaban KOTELEZO, tehat biztos
          elutasitas. Egy halozati kor arra, amirol itt is tudjuk, hogy nem
          mehet, csak varakozas a bejelentonek.
        */}
        <button
          type="button"
          disabled={ment || cim.trim() === ""}
          onClick={() => void mentes()}
        >
          {ment ? "Mentés…" : "Mentés"}
        </button>
      </div>
    </article>
  );
}
