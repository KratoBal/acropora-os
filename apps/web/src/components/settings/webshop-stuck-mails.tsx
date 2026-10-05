"use client";

import { PilotBadge, PilotButton, PilotCard } from "@acropora/ui";
import {
  MAIL_TEMPLATE_EVENTS,
  WEBSHOP_MAIL_KEYS,
  isWebshopMailTemplate,
  type WebshopStuckMail,
  type WebshopStuckMailList,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { webshopMailOutboxApi } from "@/lib/api/webshop-mail-outbox";

/**
 * A WEBSHOP ELAKADT LEVELEI A LEVÉLSABLONOK LAPON.
 *
 * Balázs döntése (2026-10-05 20:11 UTC): beépített tartalék-levél nincs. Amit
 * az OS nem tud renderelni, az a webshop sorában vár, és itt látszik, a
 * render-végpont saját hibaüzenetével. A sablon kijavítása után az „Újra
 * sorba” gomb visszateszi: a webshop két percen belül elküldi.
 *
 * Ha a sor nem olvasható (a webshop oldala még nincs kint, vagy nem
 * elérhető), a panel egy sorban kimondja, és a szerkesztő ettől nem akad el.
 */
const templateName = (template: string) => {
  if (!isWebshopMailTemplate(template)) return template;
  const key = WEBSHOP_MAIL_KEYS[template];
  return MAIL_TEMPLATE_EVENTS.find((e) => e.id === key)?.name ?? template;
};

const KIND: Record<
  NonNullable<WebshopStuckMail["failure_kind"]>,
  { label: string; variant: "danger" | "amber" }
> = {
  permanent: { label: "Sablon-hiba", variant: "danger" },
  config: { label: "Beállítási hiba", variant: "danger" },
  transient: { label: "Újrapróbálás folyik", variant: "amber" },
};

const time = (iso: string) =>
  new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function WebshopStuckMails({
  token,
  onOpenTemplate,
}: {
  token: string;
  /** Opens the template a stuck mail came from, to fix it. */
  onOpenTemplate: (key: string) => void;
}) {
  const [list, setList] = useState<WebshopStuckMailList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setList(await webshopMailOutboxApi.stuck(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nem olvasható.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (id: string) => {
    setBusy(id);
    try {
      await webshopMailOutboxApi.retry(token, id);
      setRowError(({ [id]: _, ...rest }) => rest);
      await load();
    } catch (e) {
      setRowError((r) => ({
        ...r,
        [id]: e instanceof Error ? e.message : "Nem sikerült.",
      }));
    } finally {
      setBusy(null);
    }
  };

  if (error)
    return (
      <p className="text-xs text-pilot-grey-500">
        Az elakadt webshop levelek most nem olvashatók: {error}
      </p>
    );
  if (!list || list.count === 0) return null;

  return (
    <PilotCard className="p-5">
      <h2 className="text-base font-semibold text-pilot-red-700">
        Elakadt webshop levelek ({list.count})
      </h2>
      <p className="mt-1 text-xs text-pilot-grey-500">
        Ezek a levelek nem mentek ki a vevőnek. A sablon-hibát javítsd a
        sablonban, utána tedd újra sorba: a webshop két percen belül elküldi.
      </p>
      <ul
        aria-label="Elakadt levelek"
        className="mt-4 divide-y divide-pilot-grey-100"
      >
        {list.items.map((mail) => {
          const kind = mail.failure_kind ? KIND[mail.failure_kind] : null;
          return (
            <li
              key={mail.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    type="button"
                    className="font-semibold text-pilot-grey-900 underline-offset-2 hover:underline"
                    onClick={() =>
                      isWebshopMailTemplate(mail.template) &&
                      onOpenTemplate(WEBSHOP_MAIL_KEYS[mail.template])
                    }
                  >
                    {templateName(mail.template)}
                  </button>
                  {mail.display_id !== null ? (
                    <span className="text-pilot-grey-600">
                      #{mail.display_id}
                    </span>
                  ) : null}
                  {kind ? (
                    <PilotBadge variant={kind.variant}>{kind.label}</PilotBadge>
                  ) : null}
                </p>
                <p className="text-xs text-pilot-grey-500">
                  {mail.to} · {time(mail.created_at)} óta · {mail.attempts}{" "}
                  próbálkozás
                </p>
                {mail.last_error ? (
                  <p className="text-xs text-pilot-grey-700">
                    {mail.last_error}
                  </p>
                ) : null}
                {rowError[mail.id] ? (
                  <p role="alert" className="text-xs text-pilot-red-700">
                    {rowError[mail.id]}
                  </p>
                ) : null}
              </div>
              <PilotButton
                variant="secondary"
                disabled={busy !== null}
                aria-label={`Újra sorba: ${templateName(mail.template)} #${mail.display_id ?? ""}`}
                onClick={() => void retry(mail.id)}
              >
                {busy === mail.id ? "Sorba teszem…" : "Újra sorba"}
              </PilotButton>
            </li>
          );
        })}
      </ul>
    </PilotCard>
  );
}
