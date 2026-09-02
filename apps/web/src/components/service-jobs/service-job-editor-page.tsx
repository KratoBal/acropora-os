"use client";

import { Alert, Button, Card, Input, PageHeader } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type CustomerSummary,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { PartnerPicker } from "./partner-picker";

/**
 * ÚJ HIBAJEGY, BELSŐ FELVITEL.
 *
 * EZ A FOLYAMAT MÁSODIK FELE, névvel: „a lap eljut a felelőshöz (aki ilyenkor
 * MI vagyunk), a felelős létrehozza a hibajegyet, és a meglévő lap annak
 * részévé válik" (Balázs, 2026-09-02 08:02). Tehát a jegyet BELÜL nyitjuk, egy
 * bejelentkezett kollégaként - az ügyfél-oldali bejelentés külön munka, és az
 * ügyfélportál kérdése.
 *
 * A PARTNER NEM KÖTELEZŐ, és ez nem lazaság. A tipikus úton a jegy egy MÁR
 * MEGLÉVŐ lapból születik, a lapnak pedig van partnere - vagyis a partner
 * ADOTT, nem beírandó. Ha itt kötelezővé tennénk, épp azt az utat nehezítenénk,
 * amit a fenti döntés leír. A partner nélküli jegy ezért nem hiba, hanem
 * ÁTMENETI állapot, és a csatolás mai tiltása erre az átmenetre szól.
 *
 * A VÁLASZTÓ KERES, NEM LISTÁZ. A vevő-lista lapozott, és egy oldal legfeljebb
 * százat ad: egy sima legördülő CSENDBEN levágná a többit, és a hiányzó partner
 * úgy nézne ki, mintha nem is létezne.
 */
export function ServiceJobEditorPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod hibajegyet nyitni"
        description="service.manage jogosultság szükséges."
      />
    );

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await serviceJobsApi.create(token, {
        title: title.trim(),
        description: description.trim() || null,
        customerId: customer?.id ?? null,
      });
      // A FRISS JEGY LAPJÁRA VISZÜNK, nem a listára: aki most nyitotta, azt
      // akarja folytatni - munkalapot csatolni, léptetni.
      router.push(`/szerviz/hibajegyek/${created.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A hibajegy nem jött létre.",
      );
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Szerviz"
        title="Új hibajegy"
        description="A hibajegy a lánc első eleme. A munkalapokat utólag lehet alá csatolni - a lap keletkezhet előbb is, mint a jegy."
      />
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      <Card className="space-y-4 p-4">
        <div className="space-y-1">
          <label className="text-sm font-semibold" htmlFor="hibajegy-cim">
            Mi a baj?
          </label>
          <Input
            id="hibajegy-cim"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Például: a hármas medence szivattyúja nem indul"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold" htmlFor="hibajegy-leiras">
            Részletek
          </label>
          <textarea
            id="hibajegy-leiras"
            className="w-full rounded border px-2 py-1 text-sm"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold" htmlFor="hibajegy-partner">
            Partner
          </label>
          {customer ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{customer.displayName}</span>
              <button
                type="button"
                className="text-xs text-slate-500 underline"
                onClick={() => setCustomer(null)}
              >
                Másik partner
              </button>
            </div>
          ) : (
            <>
              <PartnerPicker id="hibajegy-partner" onPick={setCustomer} />
              {/*
                A HIÁNY IS ÁLLÍTÁS: a partner elhagyható, és ezt ki kell mondani,
                különben a felhasználó keresni fog valamit, ami nem hiányzik.
                A következménye viszont ott áll mellette, mert az MA korlátoz.
              */}
              <p className="pt-1 text-xs text-slate-500">
                Elhagyható. Partner nélkül a jegy megnyílik, de munkalapot csak
                azután lehet alá csatolni, hogy a partnere megvan.
              </p>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            disabled={!title.trim() || saving}
            onClick={() => void submit()}
          >
            Hibajegy megnyitása
          </Button>
        </div>
      </Card>
    </div>
  );
}
