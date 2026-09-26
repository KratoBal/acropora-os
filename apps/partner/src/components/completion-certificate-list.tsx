"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon, PilotThemeRoot } from "@acropora/ui";

import { partnerApi } from "@/lib/api";
import { Message } from "./ticket-list";

/**
 * A TELJESÍTÉSI IGAZOLÁSOK LISTÁJA -- ugyanaz a kör, mint a `maintenance-
 * order-list.tsx`, lásd annak fejlécét a sorozat és a jóváhagyás hátteréért.
 *
 * AZ "ALÁÍRT PÉLDÁNY" OSZLOP SZÖVEG, NEM JELVÉNY -- a Figma terv is így
 * mutatja (`c.alairvaPeldany ? 'feltöltve' : 'még nincs'`), és ez nem
 * díszítés: az igazolásnak NINCS állapota (lásd a séma `CompletionCertificate`
 * fejlécét), tehát nincs mit jelvénnyel jelezni.
 *
 * A TELJES SOR KATTINTHATÓ -- lásd `maintenance-order-list.tsx` fejlécét,
 * ugyanaz a javítás, ugyanaz a minta.
 */
export function CompletionCertificateList() {
  const router = useRouter();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof partnerApi.completionCertificates>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await partnerApi.completionCertificates());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A teljesítési igazolások nem tölthetők be.",
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
          Szervizmunka
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Teljesítési igazolások
        </h1>
        <p className="mt-0.5 text-sm text-pilot-grey-400">
          A karbantartási munkák befejezésének igazolásai.
        </p>
      </div>

      {error ? <Message tone="error" text={error} retry={load} /> : null}

      {!data && !error ? (
        <p className="text-sm text-pilot-grey-400">
          Teljesítési igazolások betöltése…
        </p>
      ) : null}

      {data?.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-white py-24 text-center ring-1 ring-pilot-grey-200">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="clipboard" size={24} className="text-pilot-aqua-600" />
          </div>
          <p className="text-base font-semibold text-pilot-grey-700">
            Nincs teljesítési igazolás
          </p>
        </div>
      ) : null}

      {data?.items.length ? (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-pilot-grey-200">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-pilot-grey-100">
                {[
                  "Igazolás száma",
                  "Helyszín",
                  "Kiállítva",
                  "Kiállította",
                  "Aláírt példány",
                ].map((head) => (
                  <th
                    key={head}
                    className="whitespace-nowrap px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((certificate, index) => (
                <tr
                  key={certificate.id}
                  onClick={() =>
                    router.push(`/teljesitesi-igazolasok/${certificate.id}`)
                  }
                  className={`group cursor-pointer border-b border-pilot-grey-100 transition-colors last:border-0 hover:bg-pilot-aqua-50/40 ${
                    index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                  }`}
                >
                  <td className="px-5 py-3">
                    <span className="font-mono text-pilot-grey-900 transition-colors group-hover:text-pilot-aqua-700">
                      {certificate.number}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-600">
                    {certificate.departmentName}
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-500">
                    {new Date(certificate.issuedAt).toLocaleDateString("hu-HU")}
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-600">
                    {certificate.issuedByName ?? "—"}
                  </td>
                  <td className="px-5 py-3">
                    {certificate.hasSignedDocument ? (
                      <span className="text-xs font-medium text-pilot-aqua-600">
                        feltöltve
                      </span>
                    ) : (
                      <span className="text-xs italic text-pilot-grey-400">
                        még nincs
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}
