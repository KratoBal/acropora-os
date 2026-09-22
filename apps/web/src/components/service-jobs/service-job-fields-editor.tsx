"use client";

import { Button, Input, Textarea } from "@acropora/ui";
import { useState } from "react";

import {
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";
import { serviceJobsApi } from "@/lib/api/service-jobs";

/**
 * A JEGY CIMENEK ES LEIRASANAK JAVITASA A FELVITEL UTAN.
 *
 * Balazs kerese, 2026-09-22. A peldaja a cim volt: „Most is van egy eles
 * hibajegy aminek elirta a cimet. En se tudom modositani".
 *
 * === A HATART A SZERVER MONDJA KI, NEM EZ A KOMPONENS ===
 *
 * A lap ELREJTI a szerkesztot lezart jegyen (`isFinishedServiceJob`, a KOZOS
 * csomagbol -- ugyanabbol a listabol, amibol a szerver dolgozik), de az
 * elutasitas SZOVEGE mindig a szerveré. Ket okbol:
 *
 * 1. A jegy allapota kozben mozdulhat: valaki lezarhatja, miközben ez a lap
 *    nyitva all. Ilyenkor a mentes 409-et kap, es a kezelonek azt kell
 *    latnia, AMI tortent, nem egy helyi tippet.
 * 2. A partner-hatar (van-e munkalap) ezen a feluleten nem is ertelmezheto --
 *    ha valaha ide kerulne, egy sajat mondat MASKEPP hataroznA meg a szabalyt,
 *    mint a szerver.
 */
export function ServiceJobFieldsEditor({
  jobId,
  token,
  title,
  description,
  onSaved,
}: {
  jobId: string;
  token: string;
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
    /*
      A MEZOK A MAI ERTEKROL INDULNAK, nem az elso betoltesrol: a lap kozben
      frissulhetett (mas kezelo irta at), es egy regi ertekrol indulo szerkeszto
      CSENDBEN visszairna azt.
    */
    setCim(title);
    setLeiras(description ?? "");
    setHiba(null);
    setNyitva(true);
  };

  const mentes = async () => {
    setMent(true);
    setHiba(null);
    try {
      await serviceJobsApi.updateFields(token, jobId, {
        title: cim.trim(),
        /*
          AZ URES MEZO `null`-t KULD, NEM URES SZOVEGET: a semaban a leiras
          `String?`, es a "nincs leiras" allapot a `null`. Egy ures szoveg
          harmadik allapotot csinalna ugyanabbol a ketto helyett.
        */
        description: leiras.trim() === "" ? null : leiras.trim(),
      });
      setNyitva(false);
      await onSaved();
    } catch (cause) {
      /*
        A SZERVER MONDATA MEGY KI, NEM EGY SAJAT. A hatar negy fajtajat a
        szerver kulon mondattal nevezi meg (lezart jegy, mar van munkalapja,
        nem modosithatod) -- egy helyi "nem sikerult" epp azt a kulonbseget
        tunetetne el, amiert azok a mondatok leteznek.
      */
      setHiba(
        cause instanceof Error ? cause.message : "A hibajegy nem módosítható.",
      );
    } finally {
      setMent(false);
    }
  };

  if (!nyitva)
    return (
      <Button variant="secondary" onClick={kezdes}>
        Bejelentés szerkesztése
      </Button>
    );

  return (
    <ServicePanel className="space-y-3">
      <ServicePanelHeading title="A bejelentés szerkesztése" />
      {hiba ? (
        <p role="alert" className="text-sm text-rose-700">
          {hiba}
        </p>
      ) : null}
      <label className="block space-y-1">
        <span className="text-sm font-medium text-dusk-700">Cím</span>
        <Input
          aria-label="A hibajegy címe"
          value={cim}
          maxLength={300}
          onChange={(event) => setCim(event.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-dusk-700">Leírás</span>
        <Textarea
          aria-label="A hibajegy leírása"
          value={leiras}
          rows={6}
          maxLength={4000}
          onChange={(event) => setLeiras(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {/*
          A MENTES TILTVA URES CIMNEL, es ez nem a szerver helyett dont: a cim a
          semaban KOTELEZO, tehat az ures mezo BIZTOSAN elutasitas. Egy halozati
          kor arra, amirol mar itt tudjuk, hogy nem mehet, csak varakozas.
        */}
        <Button
          disabled={ment || cim.trim() === ""}
          onClick={() => void mentes()}
        >
          {ment ? "Mentés…" : "Mentés"}
        </Button>
        <Button
          variant="secondary"
          disabled={ment}
          onClick={() => setNyitva(false)}
        >
          Mégsem
        </Button>
      </div>
    </ServicePanel>
  );
}
