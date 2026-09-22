"use client";

import { useEffect, useState } from "react";

import { Alert, Button, FormField, Input, Textarea } from "@acropora/ui";
import type {
  ServiceJobHandoverMailPreview,
  ServiceJobHandoverMailSkipReason,
} from "@acropora/types";

/**
 * A LEZART HIBAJEGY KIKULDESE -- A KEZELO ABLAKA.
 *
 * Balazs specje, 2026-09-18 11:29 UTC, szo szerint: "A kuldes felhoz egy
 * ablakot, ahol latszik a cimzett, cimzettek neve, email cime. Ez alatt egy
 * targy mezo ahova automatikusan bekerul a hibajegy szama [...] Ez alatt egy
 * uzenet mezo ahova uzenetet tudok irni ami a level torzse lesz. majd egy
 * elkuld gomb".
 *
 * === EZ A MEGEROSITES, NEM EGY LEPES ELOTTE ===
 *
 * Nem `ConfirmDialog` all elotte, es ez nem kimaradas. Az a komponens egy
 * IGEN/NEM kerdes; itt a kezelo a kuldes kozben irja meg, MIT kuld -- vagyis
 * az ablak MAGA a megerosites, es a benne levo adat a dontes alapja.
 *
 * AMIT VISZONT ATVESZUNK BELOLE: a muvelet VISSZAFORDITHATATLAN, es ezt ki
 * kell mondani. Egy elkuldott level nem vonhato vissza -- a gomb felirata
 * ezert nevezi meg a cimzettek szamat, es a figyelmeztetes a gomb MELLETT
 * all, nem a fejlecben.
 */

/**
 * A HAT KIHAGYASI OK HAT KULON MONDATA.
 *
 * `Record<...>`, NEM egy `switch` alapertelmezett aggal: ha a szerver egy
 * ujabb okot vezet be, ez FORDITASI HIBA lesz. Egy alapertelmezett ag csendben
 * "ismeretlen ok"-ot mutatna a kezelonek, es a felulet zolden allna tovabb.
 *
 * ES EZ A JOSLAT BEVALT, 2026-09-22-en. Amikor a levelezes harom utja kulon
 * kapcsolot kapott, a `mode-off` ketteesett (`mail-off` es `path-off`), es a
 * fordito PONTOSAN ITT allt meg -- nem a felhasznalonal, egy ures mondattal.
 * Ez a bekezdes ezert nem a szandekot irja le tovabb, hanem egy MERT esetet.
 *
 * Mindegyik mondat a TEENDOT nevezi meg, nem az allapotot: a hat ok hat
 * kulonbozo embert erint, es egy kozos "nem kuldheto" mondat mindegyiknel
 * ugyanoda vezetne -- hozzank. A harom kapcsolos ok kozott is VALODI a
 * kulonbseg: az elso az egesz kornyezetre szol, a masodik EGY levelfajtara, a
 * harmadik (`no-redirect`) pedig azt mondja meg, hogy a kuldes MINDEN mas
 * felteteltol keszen all, es CSAK a cel hianyzik.
 *
 * ES A HARMADIK MASODSZOR IGAZOLTA A JOSLATOT, 2026-09-22-en: amikor a hianyzo
 * atiranyitas sajat okot kapott, a fordito megint PONTOSAN ITT allt meg. Egy
 * alapertelmezett ag helyette azt mondta volna a kezelonek, hogy "ismeretlen
 * ok" -- epp abban az allapotban, ahol a level MAJDNEM kiment.
 */
const KIHAGYAS_OKA: Record<ServiceJobHandoverMailSkipReason, string> = {
  "mail-off":
    "A levélküldés ki van kapcsolva ezen a környezeten, ezért most nem megy ki semmi. Ez üzemeltetési beállítás.",
  "path-off":
    "A levélküldés be van kapcsolva, de az átadási levél külön ki van kapcsolva. Ez is üzemeltetési beállítás, és a többi levéltípust nem érinti.",
  "no-redirect":
    "A levélküldés be van kapcsolva, de nincs megadva, hová menjenek a levelek. Amíg ez hiányzik, egyetlen levél sem megy ki senkinek. Ez üzemeltetési beállítás.",
  "no-department":
    "A hibajegyhez nincs helyszín rendelve, így nincs kinek kiküldeni. Előbb a hibajegy helyszínét kell megadni.",
  "no-customer":
    "A hibajegy helyszínéhez nem tartozik ügyfél, ezért a címzettek nem állapíthatók meg. Ez törzsadat-hiba.",
  "no-recipient":
    "Az ügyfélnek nincs aktív portál-felhasználója, ezért nincs kinek kiküldeni. A hozzáférést az ügyfélnél kell létrehozni.",
};

export interface HandoverMailDialogProps {
  open: boolean;
  jobNumber: string;
  /**
   * `null`, amig az elonezet betolt. A ket allapotot a dialogus KULON
   * kezeli: a betoltes alatt nincs gomb, mert nem tudjuk, van-e cimzett.
   */
  preview: ServiceJobHandoverMailPreview | null;
  previewError: string | null;
  sendError: string | null;
  busy: boolean;
  onSend(input: { subject: string; message: string }): void;
  onCancel(): void;
}

export function HandoverMailDialog({
  open,
  jobNumber,
  preview,
  previewError,
  sendError,
  busy,
  onSend,
  onCancel,
}: HandoverMailDialogProps) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  /*
    A TARGYAT A SZERVER TOLTI ELO, ES CSAK AKKOR, AMIKOR AZ ABLAK KINYILIK.

    Ha minden `preview` valtozasra ujratoltene, a kezelo atirt targya eltunne
    egy hattérben lefuto ujratoltestol -- es epp azt a szoveget venne el, amit
    o gepelt be.
  */
  useEffect(() => {
    if (!open) return;
    setSubject(preview?.kind === "send" ? preview.subject : "");
    setMessage("");
    // A `preview` szandekosan NEM fuggoseg: lasd a fenti bekezdest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /*
    A TARGY AZ ELSO BETOLTESKOR ERKEZIK, NEM NYITASKOR.

    A fenti hatas a nyitas pillanataban fut, amikor a `preview` meg `null`.
    Ez a masodik hatas TOLTI BE az elotoltott targyat, amint megjon -- de CSAK
    akkor, ha a mezo meg ures, tehat egy mar begepelt szoveget nem ir felul.
  */
  useEffect(() => {
    if (!open || preview?.kind !== "send") return;
    setSubject((elozo) => (elozo === "" ? preview.subject : elozo));
  }, [open, preview]);

  /*
    A BEGEPELT UZENET NEM VESZHET EL EGY FELREKATTINTASTOL.

    A `ConfirmDialog` barhol zar (Escape es hatter-kattintas), es ott ez
    helyes: ott nincs mit elveszteni. Itt a kezelo hosszu szoveget ir, es egy
    melle-kattintas a hatterre ugyanugy nez ki, mint barhol mashol a lapon.

    Ezert amint van begepelt szoveg, CSAK a Megsem gomb zar. Az ures ablak
    tovabbra is barhol zarhato -- kulonben egy vegig elolvasott, de nem
    hasznalt dialogust is gombbal kellene becsukni.
  */
  const vanSzoveg = message.trim().length > 0;
  const zarhatoKivulrol = !busy && !vanSzoveg;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && zarhatoKivulrol) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, zarhatoKivulrol, onCancel]);

  if (!open) return null;

  const cimzettek = preview?.kind === "send" ? preview.recipients : [];
  const kuldheto = preview?.kind === "send" && vanSzoveg;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dusk-900/40 p-4"
      onClick={() => {
        if (zarhatoKivulrol) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`A ${jobNumber} számú hibajegy kiküldése`}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-dusk-200 bg-white p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p className="text-sm font-semibold text-dusk-900">
            A {jobNumber} számú hibajegy kiküldése
          </p>
          <p className="text-sm text-dusk-500">
            A dokumentumcsomag csatolva megy. A feladó: Acropora Ticketing
            (ticket@acropora.hu).
          </p>
        </div>

        {previewError ? (
          <Alert
            variant="danger"
            title="A címzettek nem tölthetők be"
            description={previewError}
          />
        ) : null}

        {!preview && !previewError ? (
          <p className="text-sm text-dusk-500">Címzettek betöltése…</p>
        ) : null}

        {preview?.kind === "skip" ? (
          <Alert
            variant="info"
            title="Ez a hibajegy most nem küldhető ki"
            description={KIHAGYAS_OKA[preview.reason]}
          />
        ) : null}

        {preview?.kind === "send" ? (
          <>
            <FormField label="Címzettek">
              {/*
                A CIM IS LATSZIK, NEV SZERINT -- ez a spec szo szerinti resze.
                A lista nem szerkesztheto: a kort a helyszin gazdaja hatarozza
                meg, es egy kezi felvitel epp azt kerulne meg.
              */}
              <ul className="space-y-1" data-testid="handover-mail-recipients">
                {cimzettek.map((cimzett) => (
                  <li key={cimzett.email} className="text-sm text-dusk-900">
                    {cimzett.name}{" "}
                    <span className="text-dusk-500">({cimzett.email})</span>
                  </li>
                ))}
              </ul>
            </FormField>

            <FormField label="Tárgy" htmlFor="handover-mail-subject">
              <Input
                id="handover-mail-subject"
                value={subject}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setSubject(event.target.value)}
              />
            </FormField>

            <FormField
              label="Üzenet"
              htmlFor="handover-mail-message"
              description="Ez lesz a levél törzse, pontosan így. A rendszer semmit nem fűz hozzá."
            >
              <Textarea
                id="handover-mail-message"
                value={message}
                rows={6}
                maxLength={4000}
                disabled={busy}
                onChange={(event) => setMessage(event.target.value)}
              />
            </FormField>
          </>
        ) : null}

        {sendError ? (
          <Alert
            variant="danger"
            title="A kiküldés nem sikerült"
            description={sendError}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!kuldheto || busy}
            onClick={() => onSend({ subject, message })}
          >
            {busy ? "Kiküldés…" : `Elküldés ${cimzettek.length} címzettnek`}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Mégsem
          </Button>
        </div>
        {preview?.kind === "send" ? (
          <p className="text-sm text-dusk-500">
            Az elküldött levél nem vonható vissza.
          </p>
        ) : null}
      </div>
    </div>
  );
}
