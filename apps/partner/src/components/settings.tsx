"use client";

import { useState } from "react";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotThemeRoot,
} from "@acropora/ui";

import { partnerApi } from "@/lib/api";
import { Message } from "./ticket-list";

/**
 * BEÁLLÍTÁSOK -- FIGMA 9. KÖR, PILOT-AQUA (surgos kor, 2026-09-25, acrobot
 * kérése: "a Beallitasok, a pilot-aqua keretben, egy PR = egy kepernyo a
 * friss mainrol"). Ez az UTOLSÓ még régi-stílusú lap a portálon a
 * `new-ticket.tsx` (#1140) és az Akváriumok-sorozat előtt -- lásd
 * `portal-shell.tsx` frissített megjegyzését, ami ettől a körtől három
 * régi-stílusú lapra csökken.
 *
 * A VISELKEDÉS VÁLTOZATLAN: két önálló forma (jelszó, aláírókód), ugyanaz a
 * submit-folyamat, ugyanazok a hibaüzenetek. A `frame.tsx` `PANEL`/`LAP_*`
 * konstansai és a `globals.css` `.form`/`.detail-grid` szabályai helyett
 * `PilotCard`/`PilotFormField`/`PilotButton` és Tailwind-osztályok.
 *
 * KÉT KOMPENZÁLÓ VÁLTOZÁS, UGYANAZ A MINTA, MINT A MUNKALAP-ADATLAP
 * ALÁÍRÓKÓD-MEZŐJÉNÉL (#1129, `worksheet-detail.tsx`): a `PilotInput`-nak
 * nincs `required`/`minLength`/`pattern`/`maxLength` propja, ezért a natív
 * validáció helyett a submit gomb marad letiltva, amíg a feltétel nem
 * teljesül -- ez véd a "néma no-op" ellen (a gomb megnyomható, de a
 * kérés soha nem menne át a szerver saját ellenőrzésén sem):
 *   - az új jelszó legalább 8 karakter (`password.next.length < 8`),
 *   - az aláírókód pontosan 4 számjegy, és az `onChange` maga szűri a
 *     nem-számjegy karaktereket (`replace(/\D/g, "")`), ugyanúgy, ahogy a
 *     `PilotInput`-nak nincs `pattern`-je sem.
 */
export function Settings() {
  const [password, setPassword] = useState({ current: "", next: "" });
  const [signing, setSigning] = useState({ current: "", code: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await partnerApi.changePassword(password.current, password.next);
      setPassword({ current: "", next: "" });
      setMessage("A jelszó megváltozott.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A jelszó nem változtatható meg.",
      );
    }
  }
  async function changeSigningCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await partnerApi.changeSigningCode(signing.current, signing.code);
      setSigning({ current: "", code: "" });
      setMessage("Az aláírókód megváltozott.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az aláírókód nem változtatható meg.",
      );
    }
  }

  const passwordValid =
    password.current.length > 0 && password.next.length >= 8;
  const signingValid = signing.current.length > 0 && signing.code.length === 4;

  return (
    <PilotThemeRoot className="flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          FIÓK
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Beállítások
        </h1>
        <p className="mt-1 text-sm text-pilot-grey-400">
          Itt kizárólag a saját fiókjának adatait módosíthatja.
        </p>
      </div>

      <div className="flex-1 px-8 py-6">
        {message ? (
          <div className="mb-4">
            <Message tone="info" text={message} />
          </div>
        ) : null}
        {error ? (
          <div className="mb-4">
            <Message tone="error" text={error} />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <PilotCard>
            <PilotCardHeader title="Jelszó módosítása" />
            <form
              className="flex flex-col gap-4 px-5 py-5"
              onSubmit={changePassword}
            >
              <PilotFormField label="Jelenlegi jelszó" required>
                <PilotInput
                  type="password"
                  value={password.current}
                  onChange={(value) =>
                    setPassword({ ...password, current: value })
                  }
                />
              </PilotFormField>
              <PilotFormField
                label="Új jelszó"
                required
                help="Legalább 8 karakter."
              >
                <PilotInput
                  type="password"
                  value={password.next}
                  onChange={(value) =>
                    setPassword({ ...password, next: value })
                  }
                />
              </PilotFormField>
              <div>
                <PilotButton type="submit" disabled={!passwordValid}>
                  Jelszó módosítása
                </PilotButton>
              </div>
            </form>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Aláírókód módosítása" />
            <form
              className="flex flex-col gap-4 px-5 py-5"
              onSubmit={changeSigningCode}
            >
              <p className="text-sm text-pilot-grey-500">
                A négyjegyű kód módosításához a jelenlegi jelszava szükséges.
              </p>
              <PilotFormField label="Jelenlegi jelszó" required>
                <PilotInput
                  type="password"
                  value={signing.current}
                  onChange={(value) =>
                    setSigning({ ...signing, current: value })
                  }
                />
              </PilotFormField>
              <PilotFormField
                label="Új, négyjegyű aláírókód"
                required
                help="Pontosan 4 számjegy."
              >
                <PilotInput
                  inputMode="numeric"
                  value={signing.code}
                  onChange={(value) =>
                    setSigning({
                      ...signing,
                      code: value.replace(/\D/g, "").slice(0, 4),
                    })
                  }
                />
              </PilotFormField>
              <div>
                <PilotButton type="submit" disabled={!signingValid}>
                  Aláírókód módosítása
                </PilotButton>
              </div>
            </form>
          </PilotCard>
        </div>
      </div>
    </PilotThemeRoot>
  );
}
