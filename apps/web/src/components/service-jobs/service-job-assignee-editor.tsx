"use client";

import { Button } from "@acropora/ui";

import {
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";
import type { ServiceJobAssignee, ServiceJobDetail } from "@acropora/types";
import { useEffect, useState } from "react";

import { serviceJobsApi } from "@/lib/api/service-jobs";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "@/components/worksheets/worksheet-assignee-picker";

export interface ServiceJobAssigneeEditorProps {
  jobId: string;
  token: string;
  assignees: ServiceJobAssignee[];
  canManage: boolean;
  onSaved: (detail: ServiceJobDetail) => void;
}

/**
 * KI DOLGOZIK A HIBAJEGYEN.
 *
 * Balazs kerese (2026-09-14 18:10, Discord, Szerviz ticketing szal, szo
 * szerint): „Majd ez alatt a szervizes kollegakat lehessen delegalni akik errol
 * ertesitest kapnak es meg tudjak nyitni a munkalapot."
 *
 * === A VALASZTO A MUNKALAPE, ES EZ NEM KOLCSONZES ===
 *
 * A `WorksheetAssigneePicker` a MUNKALAP mappajaban all, mert a VEGPONT is ott
 * lakik: a valaszthato kollegak listajat a `worksheets/assignable-users` adja
 * (`SERVICE_VIEW` joggal kapuzva, nem munkalap-joggal). A komponens
 * athelyezese egy semleges mappaba a fuggoseget NEM szuntetne meg, csak
 * ELREJTENE -- a vegpont mozgatasa pedig szerver-valtozas, kulon dontes.
 *
 * Amit ez a fajl hozzatesz, az a MENTES, es azert kulon: a felvitelkor a
 * delegaltak a letrehozas payloadjanak reszei (egy tranzakcio), itt pedig sajat
 * gomb kuldi oket. A ketto nem ugyanaz a muvelet, es osszevonva az egyik
 * oldalon mindig hazudna a gomb.
 *
 * === A LISTA MINDENKINEK LATSZIK, A SZERKESZTES NEM ===
 *
 * Ugyanaz a ket jog, amit a szerver kulonboztet: `service.view` olvas,
 * `service.manage` ir. Ha a kepernyo a gombot olvasonak is kiirna, a kattintas
 * 403-at adna, es a felhasznalo azt hinne, elromlott valami.
 */
export function ServiceJobAssigneeEditor({
  jobId,
  token,
  assignees,
  canManage,
  onSaved,
}: ServiceJobAssigneeEditorProps) {
  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage,
  );
  const [selected, setSelected] = useState<string[]>(
    assignees.map((assignee) => assignee.userId),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A KIJELOLES A SZERVER VALASZAT KOVETI, nem a sajat elozo allapotat. Ha
   * kozben valaki MAS irta at a nevsort, a mentes utani valasz azt hozza -- es
   * a kepernyon nem maradhat ott egy olyan kijeloles, ami sehol nem letezik.
   */
  useEffect(() => {
    setSelected(assignees.map((assignee) => assignee.userId));
  }, [assignees]);

  const toggle = (userId: string) => {
    setSelected((current) => toggleAssignee(current, userId));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      /**
       * A VALASZ A TELJES RESZLETLAP, TEHAT NEM TOLTUNK UJRA. A szerver
       * ugyanazt a sort adja vissza, amit a kepernyo rajzol; egy kulon
       * lekerdezes egy folosleges kor lenne, es a ket valasz kozott a jegy mar
       * mozdulhatott.
       */
      onSaved(
        await serviceJobsApi.setAssignees(token, jobId, { userIds: selected }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A delegálás mentése nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  const current = assignees.map((assignee) => assignee.userId);
  const changed =
    selected.length !== current.length ||
    selected.some((userId) => !current.includes(userId));

  return (
    <ServicePanel className="space-y-3">
      <ServicePanelHeading title="Delegált kollégák" />
      {assignees.length ? (
        <ul className="text-sm">
          {assignees.map((assignee) => (
            <li key={assignee.userId}>{assignee.name}</li>
          ))}
        </ul>
      ) : (
        /* A HIANY IS ALLITAS: egy ures doboz betoltesi hibanak latszik, es a
           kezelo megvarja. Ez a mondat kimondja, hogy nincs mire varni. */
        <p className="text-sm text-dusk-500">
          Erre a jegyre még nincs delegálva senki.
        </p>
      )}

      {canManage ? (
        <>
          <WorksheetAssigneePicker
            candidates={candidates}
            selected={selected}
            onToggle={toggle}
          />
          {(error ?? candidatesError) ? (
            <p className="text-xs font-medium text-rose-600">
              {error ?? candidatesError}
            </p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={!changed || saving}
            onClick={() => void save()}
          >
            {saving ? "Mentés..." : "Delegálás mentése"}
          </Button>
        </>
      ) : null}
    </ServicePanel>
  );
}
