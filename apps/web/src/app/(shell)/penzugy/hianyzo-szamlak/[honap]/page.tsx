import { notFound } from "next/navigation";

import { MissingInvoicesMonthPage } from "@/components/finance/missing-invoices/missing-invoices-month-page";

/** Egy hónap: `/penzugy/hianyzo-szamlak/2026-08`. Más alak nem hónap. */
export default async function MissingInvoicesMonthRoute({
  params,
}: {
  params: Promise<{ honap: string }>;
}) {
  const { honap } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(honap)) notFound();
  return <MissingInvoicesMonthPage month={honap} />;
}
