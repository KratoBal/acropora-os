import type {
  ServiceJobDetail,
  ServiceJobListResponse,
  ServiceJobStatusValue,
} from "@acropora/types";

import { apiRequest } from "./client";

const base = "/service/jobs";

function jobPath(id: string, suffix = "") {
  return `${base}/${encodeURIComponent(id)}${suffix}`;
}

export const serviceJobsApi = {
  list(token: string, scope: "open" | "all", signal?: AbortSignal) {
    return apiRequest<ServiceJobListResponse>(`${base}?scope=${scope}`, token, {
      signal,
    });
  },
  /**
   * UJ HIBAJEGY. A valasz az AZONOSITOT es a SZAMOT hozza, mert a felvitel utan
   * a felulet a friss jegy lapjara visz -- egy sikeruzenet a listan azt hagyna
   * a felhasznalora, hogy megkeresse, amit epp letrehozott.
   */
  create(
    token: string,
    input: {
      title: string;
      description?: string | null;
      customerId?: string | null;
    },
  ) {
    return apiRequest<{ id: string; jobNumber: string }>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ServiceJobDetail>(jobPath(id), token, { signal });
  },
  /**
   * EGY MEGLEVO LAP A JEGY ALA. A valasz itt is csak nyugta, tehat a hivo
   * ujratolt - a csatolt lap a naploban ES a lista-szakaszban is megjelenik,
   * es azt egy nyugtabol nem lehet felepiteni.
   */
  attachWorksheet(token: string, id: string, worksheetId: string) {
    return apiRequest<{ ok: true }>(jobPath(id, "/worksheets"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worksheetId }),
    });
  },
  /**
   * PARTNER EGY MEG PARTNER NELKULI JEGYRE. A valasz nyugta, tehat a hivo
   * ujratolt: a partner neve a fejlecben es a csatolo doboz megjelenese is
   * ettol fugg.
   */
  setPartner(token: string, id: string, customerId: string) {
    return apiRequest<{ ok: true }>(jobPath(id, "/partner"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });
  },
  /**
   * A CSATOLAS VISSZAUTJA. Enelkul egy rossz valasztas a legordulobol orokre
   * ott hagyna a lapot a jegy alatt.
   */
  detachWorksheet(token: string, id: string, worksheetId: string) {
    return apiRequest<{ ok: true }>(
      jobPath(id, `/worksheets/${encodeURIComponent(worksheetId)}`),
      token,
      { method: "DELETE" },
    );
  },
  /**
   * A LÉPÉS VÁLASZA CSAK NYUGTA (`{ ok: true }`), nem a friss jegy.
   *
   * Ezért a hívó ÚJRATÖLT utána. Ha a nyugtából építenénk fel a képernyőt, a
   * napló új sora hiányozna róla - és épp az a sor a lépés bizonyítéka.
   */
  move(
    token: string,
    id: string,
    input: { to: ServiceJobStatusValue; note?: string | null },
  ) {
    return apiRequest<{ ok: true }>(jobPath(id, "/move"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
