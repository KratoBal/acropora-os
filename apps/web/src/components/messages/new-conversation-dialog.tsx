"use client";

import type { ConversationDetail, ConversationPerson } from "@acropora/types";
import { Button, Icon, Input } from "@acropora/ui";
import { useEffect, useState } from "react";

import { messagesApi } from "@/lib/api/messages";
import { ROLE_LABELS } from "@/components/users/role-labels";

import { Monogram, assistantFirst } from "./conversation-parts";

/**
 * ÚJ BESZÉLGETÉS (Figma 443:53). Egy kiválasztott kolléga DIRECT beszélgetést
 * nyit (ha már van, a meglévőt), több GROUP-ot, aminek nevet is adhat. A
 * kereshető kollégák listáját a szerver adja: partnerfiók, gépi ágens és
 * inaktív kolléga nincs rajta.
 */
export function NewConversationDialog({
  token,
  onClose,
  onCreated,
}: {
  token: string;
  onClose: () => void;
  onCreated: (conversation: ConversationDetail) => void;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<ConversationPerson[]>([]);
  const [chosen, setChosen] = useState<ConversationPerson[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void messagesApi
        .people(token, query.trim(), controller.signal)
        .then((response) => setPeople(response.items))
        .catch(() => {
          if (!controller.signal.aborted)
            setError("A kollégák listája nem töltődött be.");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, token]);

  const isChosen = (person: ConversationPerson) =>
    chosen.some((c) => c.userId === person.userId);
  const toggle = (person: ConversationPerson) =>
    setChosen((current) =>
      isChosen(person)
        ? current.filter((c) => c.userId !== person.userId)
        : [...current, person],
    );

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await messagesApi.create(token, {
          memberIds: chosen.map((c) => c.userId),
          ...(chosen.length > 1 && title.trim() ? { title: title.trim() } : {}),
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A beszélgetés nem indult el.",
      );
      setBusy(false);
    }
  };

  // a kiválasztottak a lista tetején maradnak akkor is, ha a keresés kiszűrné őket
  const listed = [
    ...chosen,
    ...assistantFirst(people.filter((person) => !isChosen(person))),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pilot-grey-900/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="uj-beszelgetes-cim"
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 border border-pilot-grey-200 bg-white p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2
            id="uj-beszelgetes-cim"
            className="text-2xl font-semibold text-pilot-grey-900"
          >
            Új beszélgetés
          </h2>
          <p className="text-sm text-pilot-grey-600">
            Válassz egy vagy több kollégát.
          </p>
        </div>
        <label className="relative block">
          <span className="sr-only">Kolléga keresése</span>
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-500"
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Kolléga keresése…"
            className="pl-9"
          />
        </label>
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Kollégák">
          {listed.map((person) => (
            <li key={person.userId}>
              <label
                className={`flex cursor-pointer items-center gap-3 px-3 py-3 ${
                  isChosen(person)
                    ? "bg-pilot-accent-warm-soft"
                    : "hover:bg-pilot-grey-50"
                }`}
              >
                <Monogram
                  name={person.name}
                  assistant={person.kind === "assistant"}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-pilot-grey-900">
                    {person.name}
                  </span>
                  <span className="block truncate text-xs text-pilot-grey-600">
                    {person.kind === "assistant"
                      ? "Segéd, kérdezd bármiről"
                      : ROLE_LABELS[person.role]}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={isChosen(person)}
                  onChange={() => toggle(person)}
                  className="size-5 accent-pilot-accent-warm"
                />
              </label>
            </li>
          ))}
          {listed.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-pilot-grey-500">
              Nincs találat.
            </li>
          ) : null}
        </ul>
        {chosen.length > 1 ? (
          <label className="block text-sm text-pilot-grey-700">
            A csoport neve (nem kötelező)
            <Input
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="pl. Zoo szerviz"
              className="mt-1"
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-pilot-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Mégse
          </Button>
          <Button
            onClick={() => void start()}
            disabled={busy || chosen.length === 0}
            className="bg-pilot-accent-warm hover:bg-pilot-accent-warm-text"
          >
            Indítás
          </Button>
        </div>
      </div>
    </div>
  );
}
