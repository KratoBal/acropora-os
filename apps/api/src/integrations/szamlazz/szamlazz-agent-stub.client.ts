import { randomUUID } from "node:crypto";

import type { SzamlazzAgentClient } from "./szamlazz-agent.client.js";
import type { SzamlazzAgentResponse } from "./szamlazz-agent-xml.js";

/**
 * A SZÁMLÁZZ.HU ÁLSZÁMLÁZÓJA A TESZT-SZERVERHEZ (Webshop / Rendelések, 4. PR;
 * acrobot 26310: a staging-en valódi kiállítás nem lehet, az álszámlázó
 * kapcsolóval menjen).
 *
 * `SZAMLAZZ_AGENT_MODE=stub` mellett a kiállítás NEM hívja a Számlázz.hu-t, és
 * a tárolt Agent-kulcsot sem olvassa: a válasz egy `TESZT-` kezdetű sorszám és
 * egy egyoldalas PDF, rajta, hogy nem valódi számla. Így a staging-en a
 * számlázás lépése végigpróbálható, és a sorszám első ránézésre nem
 * keverhető össze egy valódival.
 *
 * Alapból KI van kapcsolva. A `BILLING_ISSUE_ENABLED=true`-val együtt nem
 * kapcsolható be: a kettő ellentmond egymásnak, és a kiállítás megáll
 * (`billingIssueMode`).
 */
export function szamlazzAgentStubMode(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.SZAMLAZZ_AGENT_MODE?.trim().toLowerCase() === "stub";
}

/** Egy minimális, érvényes PDF egy sor szöveggel (Helvetica, csak ASCII). */
function stubPdf(text: string): Buffer {
  const safe = text.replace(/[^\x20-\x7e]/g, "?").replace(/[()\\]/g, "");
  const stream = `BT /F1 14 Tf 72 760 Td (${safe}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

export class StubSzamlazzAgentClient implements SzamlazzAgentClient {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async generateInvoice(): Promise<SzamlazzAgentResponse> {
    const number = `TESZT-${this.now().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    return {
      successful: true,
      invoiceNumber: number,
      pdf: stubPdf(`TESZT SZAMLA, NEM VALODI: ${number}`),
    };
  }
}
