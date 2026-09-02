"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ContentChannel,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentApi } from "@/lib/api/content";

/**
 * A CSATORNA KÖTELEZŐ, ÉS NINCS ALAPÉRTELMEZÉSE.
 *
 * Nem az űrlap szigora, hanem a modellé: egy előre kiválasztott csatorna azt
 * jelentené, hogy a leggyakoribb választás beleíródik azokba a tételekbe is,
 * ahol senki nem gondolt rá - és a csatorna később a megjelenítést meg az
 * ütemezést is eldönti.
 */
const CSATORNAK: { ertek: ContentChannel; cimke: string }[] = [
  { ertek: "FACEBOOK_POST", cimke: "Facebook poszt" },
  { ertek: "FACEBOOK_AD", cimke: "Facebook hirdetés" },
  { ertek: "ARTICLE", cimke: "Cikk" },
  { ertek: "OTHER", cimke: "Egyéb" },
];

type Mode = "draft" | "idea";

const MODES: { mode: Mode; title: string; description: string }[] = [
  {
    mode: "idea",
    title: "Ötlet feljegyzése",
    description: "Csak cím és csatorna, amikor még nincs kész szöveg.",
  },
  {
    mode: "draft",
    title: "Új tartalom",
    description: "Cím, csatorna, szöveg, kép-jelölő és tervezett nap.",
  },
];

/**
 * A FELVITEL KÜLÖN OLDALON, NEM A LISTA TETEJÉN.
 *
 * A lista onnantól KIZÁRÓLAG lektorálást szolgál (Balázs döntése,
 * 2026-09-02). A korábbi alak azért került a lista tetejére, mert a panasz az
 * volt, hogy a menü üres - az a probléma azóta megoldódott, és a felvitel
 * nyers, stílus nélküli űrlapja a lap többi részéhez képest más minőségi
 * szinten állt ugyanazon a képernyőn.
 *
 * A KÉT MÓD KÉT KÁRTYA, NEM FÜL. Az ötlet KEVESEBBET kér: cím és csatorna,
 * semmi más. Aki egy témát jegyez fel, még nem tudja a törzset, a képet vagy a
 * napot - és egy űrlap, ami ezeket kéri, arra tanít, hogy a rögzítés nagyobb
 * munka, mint amekkora. A szerveren is két külön végpont áll mögötte.
 */
export function ContentCreatePage() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canCreate = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_MANAGE),
  );

  const [mode, setMode] = useState<Mode>("draft");
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState<ContentChannel | "">("");
  const [body, setBody] = useState("");
  const [imageRequired, setImageRequired] = useState(false);
  const [plannedFor, setPlannedFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kuldheto = title.trim().length > 0 && channel !== "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!kuldheto || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "idea") {
        await contentApi.createIdea(token, {
          title: title.trim(),
          channel: channel as ContentChannel,
        });
      } else {
        await contentApi.create(token, {
          title: title.trim(),
          channel: channel as ContentChannel,
          // AZ ÜRES MEZŐ NEM MEGY EL. Egy üres törzs nem ugyanaz, mint a törzs
          // hiánya: az első azt állítja, hogy valaki beírt egy üres szöveget.
          ...(body.trim() ? { body: body.trim() } : {}),
          ...(imageRequired ? { imageRequired: true } : {}),
          ...(plannedFor
            ? { plannedFor: new Date(plannedFor).toISOString() }
            : {}),
        });
      }
      // VISSZA A LISTÁRA, ÉS A LISTA ÚJRA KÉRDEZ.
      //
      // Egy frissen felvett VÁZLAT `DRAFTING` állapotban a SZERZŐJÉRE vár,
      // tehát a létrehozója azonnal látja a saját "ami rám vár" listájában.
      // Egy ÖTLET viszont NEM jelenik meg ott: az `IDEA` állapot "senkire"
      // vár, és ez szándékos - csak az "ötletek" nézetben látszik. Aki ezt
      // hibának nézi és "javítja", egy mai döntést tör el.
      router.push("/tartalom");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A tétel nem menthető el.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canCreate) {
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod tartalmat felvinni"
        description="A felvitelhez content.manage jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Új tétel"
        description="Egy ötlet feljegyzése vagy egy teljes tartalom felvitele."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {MODES.map((option) => {
          const selected = option.mode === mode;
          return (
            <button
              key={option.mode}
              type="button"
              aria-pressed={selected}
              onClick={() => setMode(option.mode)}
              className={
                selected
                  ? "rounded-lg border-2 border-teal-600 bg-teal-50 p-4 text-left"
                  : "rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-300"
              }
            >
              <span className="block text-sm font-semibold text-slate-900">
                {option.title}
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent>
          <form
            onSubmit={submit}
            aria-label={
              mode === "idea" ? "Ötlet feljegyzése" : "Új tartalom felvétele"
            }
            className="space-y-4"
          >
            {error ? (
              <Alert
                variant="danger"
                title="Hiba történt"
                description={error}
              />
            ) : null}

            <FormField label="Cím">
              <Input
                aria-label="Cím"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </FormField>

            <FormField label="Csatorna">
              <Select
                aria-label="Csatorna"
                value={channel}
                onChange={(event) =>
                  setChannel(event.target.value as ContentChannel)
                }
                required
              >
                <option value="">Válassz csatornát</option>
                {CSATORNAK.map((option) => (
                  <option key={option.ertek} value={option.ertek}>
                    {option.cimke}
                  </option>
                ))}
              </Select>
            </FormField>

            {/*
              A HÁROM MEZŐ CSAK A TELJES TARTALOMNÁL. Ötletnél nem rejtve
              állnak, hanem nincsenek is: aki témát jegyez fel, ne nézzen
              szembe olyan mezőkkel, amiket most nem tud kitölteni.
            */}
            {mode === "draft" ? (
              <>
                <FormField label="Szöveg">
                  <Textarea
                    aria-label="Szöveg"
                    rows={6}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </FormField>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={imageRequired}
                    onChange={(event) => setImageRequired(event.target.checked)}
                  />
                  Kép kell hozzá
                </label>

                <FormField label="Tervezett nap">
                  <Input
                    aria-label="Tervezett nap"
                    type="date"
                    value={plannedFor}
                    onChange={(event) => setPlannedFor(event.target.value)}
                  />
                </FormField>
              </>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" disabled={!kuldheto || saving}>
                {saving ? "Mentés…" : "Mentés"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/tartalom")}
              >
                Mégse
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
