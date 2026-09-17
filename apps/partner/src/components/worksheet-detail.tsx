"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { partnerApi } from "@/lib/api";
import { DocumentPanel } from "./document-panel";
import { Message } from "./ticket-list";

export function WorksheetDetail({ id }: { id: string }) {
  const [worksheet, setWorksheet] = useState<Awaited<
    ReturnType<typeof partnerApi.worksheet>
  > | null>(null);
  const [documents, setDocuments] = useState<
    Awaited<ReturnType<typeof partnerApi.worksheetDocuments>>["items"]
  >([]);
  const [signers, setSigners] = useState<Awaited<
    ReturnType<typeof partnerApi.worksheetSigners>
  > | null>(null);
  const [signerUserId, setSignerUserId] = useState("");
  const [signatureCode, setSignatureCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, documentList, signerList] = await Promise.all([
        partnerApi.worksheet(id),
        partnerApi.worksheetDocuments(id),
        partnerApi.worksheetSigners(id),
      ]);
      setWorksheet(detail);
      setDocuments(documentList.items);
      setSigners(signerList);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A munkalap nem tölthető be.",
      );
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function sign(event: React.FormEvent) {
    event.preventDefault();
    if (!signerUserId) return;
    setSigning(true);
    setError(null);
    try {
      await partnerApi.signWorksheet(id, signerUserId, signatureCode);
      setSignatureCode("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az aláírás nem rögzíthető.",
      );
    } finally {
      setSigning(false);
    }
  }

  if (error && !worksheet)
    return (
      <section>
        <Link className="back-link" href="/munkalapok">
          ← Munkalapok
        </Link>
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!worksheet) return <p className="muted">Munkalap betöltése…</p>;
  const signature = worksheet.currentVersion.signature;
  return (
    <section>
      <Link className="back-link" href="/munkalapok">
        ← Munkalapok
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">{worksheet.number ?? "PISZKOZAT"}</p>
          <h1>{worksheet.currentVersion.subject}</h1>
          <p>
            {worksheet.department.path?.join(" / ") ??
              worksheet.department.name}
          </p>
        </div>
      </header>
      {error ? <Message tone="error" text={error} /> : null}
      <article className="panel">
        <h2>A munkalap állapota</h2>
        <p>{worksheet.currentVersion.status}</p>
        <p className="preline">
          {worksheet.currentVersion.description ??
            "Nem rögzítettek részletes leírást."}
        </p>
      </article>
      {signature ? (
        <article className="panel">
          <h2>Aláírva</h2>
          <p>
            {signature.signerName} ·{" "}
            {new Intl.DateTimeFormat("hu-HU", {
              dateStyle: "long",
              timeStyle: "short",
            }).format(new Date(signature.signedAt))}
          </p>
        </article>
      ) : (
        <form className="form panel" onSubmit={sign}>
          <h2>Munkalap aláírása</h2>
          <p>Válassza ki az aláírót, majd adja meg a négyjegyű aláírókódját.</p>
          <label>
            Aláíró
            <select
              required
              value={signerUserId}
              onChange={(event) => setSignerUserId(event.target.value)}
            >
              <option value="">Válasszon aláírót</option>
              {signers?.items.map((signer) => (
                <option key={signer.id} value={signer.id}>
                  {signer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Aláírókód
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={signatureCode}
              onChange={(event) => setSignatureCode(event.target.value)}
            />
          </label>
          {signers?.emptyReason ? (
            <p className="muted">{signers.emptyReason}</p>
          ) : null}
          <button type="submit" disabled={signing || !signers?.items.length}>
            {signing ? "Aláírás rögzítése…" : "Aláírás rögzítése"}
          </button>
        </form>
      )}
      <DocumentPanel
        title="Munkalap fényképei és fájljai"
        items={documents}
        loadBlob={(documentId) =>
          partnerApi.worksheetDocumentBlob(id, documentId)
        }
        upload={(file, caption) =>
          partnerApi.uploadWorksheetDocument(id, file, caption)
        }
        onUploaded={load}
      />
    </section>
  );
}
