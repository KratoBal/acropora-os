"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon, PilotThemeRoot } from "@acropora/ui";
import type { PartnerOverview } from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { Message } from "./ticket-list";

/**
 * ÁTTEKINTÉS, "TEENDŐIM" (kártya 28f31715; Balázs, 2026-11-25 13:07 UTC: „latna az ugyfel ... kell e alairnia vagy foglalkoznia
 * valamivel"). A portál kezdőlapja: ami MOST a partnerre vár, csoportonként a darabszámmal és a legfrissebb tételek közvetlen
 * linkjével. A számolást a szerver végzi a partner saját listáiból (`GET /service/partner-overview`); a lap csak megmutatja.
 * Alatta az "Újdonságok" (PR 2): új hibajegy és új munkalap a partner legutóbbi látogatása óta (a lista megnyitása a látogatás);
 * aki még sosem nyitotta meg, annak az utolsó hét.
 */
export function PartnerOverviewPage() {
  const [data, setData] = useState<PartnerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await partnerApi.overview());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az áttekintés nem tölthető be.",
      );
    }
  }, []);

  useEffect(() => {
    setError(null);
    void load();
  }, [load]);

  return (
    <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          Áttekintés
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">Teendőim</h1>
        <p className="mt-0.5 text-sm text-pilot-grey-400">
          Amivel most önnek kell foglalkoznia.
        </p>
      </div>

      {error ? <Message tone="error" text={error} retry={load} /> : null}

      {!data && !error ? (
        <p className="text-sm text-pilot-grey-400">Teendők betöltése…</p>
      ) : null}

      {data && data.todos.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl bg-white py-16 text-center ring-1 ring-pilot-grey-200"
          data-testid="partner-todos-empty"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="clipboard" size={24} className="text-pilot-aqua-600" />
          </div>
          <p className="text-base font-semibold text-pilot-grey-700">
            Nincs teendője
          </p>
        </div>
      ) : null}

      {data?.todos.length ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {data.todos.map((todo) => (
            <section
              key={todo.kind}
              className="rounded-xl bg-white ring-1 ring-pilot-grey-200"
              data-testid={`partner-todo-${todo.kind}`}
            >
              <header className="flex items-center justify-between border-b border-pilot-grey-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-pilot-grey-900">
                  {todo.label}
                </h2>
                <span className="rounded-full bg-pilot-amber-50 px-2.5 py-0.5 text-xs font-semibold text-pilot-amber-700">
                  {todo.count}
                </span>
              </header>
              <ul className="divide-y divide-pilot-grey-100">
                {todo.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="block px-5 py-3 text-sm text-pilot-aqua-700 hover:bg-pilot-grey-50"
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {todo.count > todo.items.length ? (
                <div className="border-t border-pilot-grey-100 px-5 py-3">
                  <Link
                    href={todo.listHref}
                    className="text-sm font-medium text-pilot-aqua-700 underline"
                  >
                    Mind a {todo.count} megtekintése
                  </Link>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}

      {data?.news?.length ? (
        <div className="mt-8" data-testid="partner-news">
          <h2 className="mb-1 text-lg font-semibold text-pilot-grey-900">
            Újdonságok
          </h2>
          <p className="mb-4 text-sm text-pilot-grey-400">
            Ami a legutóbbi látogatása óta érkezett.
          </p>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {data.news.map((news) => (
              <section
                key={news.area}
                className="rounded-xl bg-white ring-1 ring-pilot-grey-200"
                data-testid={`partner-news-${news.area}`}
              >
                <header className="flex items-center justify-between border-b border-pilot-grey-100 px-5 py-4">
                  <h3 className="text-sm font-semibold text-pilot-grey-900">
                    {news.label}
                  </h3>
                  <span className="rounded-full bg-pilot-aqua-50 px-2.5 py-0.5 text-xs font-semibold text-pilot-aqua-700">
                    {news.count}
                  </span>
                </header>
                <ul className="divide-y divide-pilot-grey-100">
                  {news.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="block px-5 py-3 text-sm text-pilot-aqua-700 hover:bg-pilot-grey-50"
                      >
                        {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
                {news.count > news.items.length ? (
                  <div className="border-t border-pilot-grey-100 px-5 py-3">
                    <Link
                      href={news.listHref}
                      className="text-sm font-medium text-pilot-aqua-700 underline"
                    >
                      Mind a {news.count} megtekintése
                    </Link>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}
