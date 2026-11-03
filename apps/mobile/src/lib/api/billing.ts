import { apiRequest } from "./client";
import type {
  ExternalDocumentDetail,
  IncomingDocumentDetail,
  IncomingDocumentListResponse,
  OutgoingDocumentListResponse,
  OwnDocumentDetail,
} from "../billing/types";

/**
 * A végpont előtagja EGY HELYEN (a többi mobil klienshez hasonlóan): egy konstansnál egy rossz előtag nem tud
 * részlegesen, csak az egyik hívásban megjavulni.
 */
const BILLING = "/billing";

/**
 * SZÁMLÁK, CSAK OLVASÁSRA (Balázs, 2026-11-03 17:01 UTC): keresés, lista, megnyitás. Ebben a modulban szándékosan
 * nincs írás: a létrehozás, a szerkesztés és a jóváhagyás a weben marad. Minden végpont `billing.view` jogot kér, ami a
 * szerveren a `finance.view`-ból vezetődik le; a szerelő (`SERVICE`) nem kapja, tehát a csempét sem, és a szerver is
 * 403-at adna neki.
 */
export function listOutgoingDocuments(page = 1, pageSize = 25, search = "") {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) query.set("q", search.trim());
  return apiRequest<OutgoingDocumentListResponse>(
    `${BILLING}/documents?${query}`,
  );
}

export function getOwnDocument(id: string) {
  return apiRequest<OwnDocumentDetail>(
    `${BILLING}/documents/${encodeURIComponent(id)}`,
  );
}

export function getExternalDocument(id: string) {
  return apiRequest<ExternalDocumentDetail>(
    `${BILLING}/external-documents/${encodeURIComponent(id)}`,
  );
}

export function listIncomingDocuments(page = 1, pageSize = 25, search = "") {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) query.set("q", search.trim());
  return apiRequest<IncomingDocumentListResponse>(
    `${BILLING}/incoming-documents?${query}`,
  );
}

export function getIncomingDocument(id: string) {
  return apiRequest<IncomingDocumentDetail>(
    `${BILLING}/incoming-documents/${encodeURIComponent(id)}`,
  );
}
