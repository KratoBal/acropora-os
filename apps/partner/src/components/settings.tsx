"use client";

import { useState } from "react";

import { partnerApi } from "@/lib/api";
import { Message } from "./ticket-list";
import {
  CIMKE,
  LAP_CIM,
  LAP_FEJLEC,
  LAP_LEIRAS,
  PANEL,
  PANEL_CIM,
} from "./frame";

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

  return (
    <section>
      <header className={LAP_FEJLEC}>
        <div>
          <p className={CIMKE}>FIÓK</p>
          <h1 className={LAP_CIM}>Beállítások</h1>
          <p className={LAP_LEIRAS}>
            Itt kizárólag a saját fiókjának adatait módosíthatja.
          </p>
        </div>
      </header>
      {message ? <Message tone="info" text={message} /> : null}
      {error ? <Message tone="error" text={error} /> : null}
      <div className="detail-grid">
        <form className={`form ${PANEL}`} onSubmit={changePassword}>
          <h2 className={PANEL_CIM}>Jelszó módosítása</h2>
          <label>
            Jelenlegi jelszó
            <input
              required
              type="password"
              value={password.current}
              onChange={(event) =>
                setPassword({ ...password, current: event.target.value })
              }
            />
          </label>
          <label>
            Új jelszó
            <input
              required
              minLength={8}
              type="password"
              value={password.next}
              onChange={(event) =>
                setPassword({ ...password, next: event.target.value })
              }
            />
          </label>
          <button type="submit">Jelszó módosítása</button>
        </form>
        <form className={`form ${PANEL}`} onSubmit={changeSigningCode}>
          <h2 className={PANEL_CIM}>Aláírókód módosítása</h2>
          <p>A négyjegyű kód módosításához a jelenlegi jelszava szükséges.</p>
          <label>
            Jelenlegi jelszó
            <input
              required
              type="password"
              value={signing.current}
              onChange={(event) =>
                setSigning({ ...signing, current: event.target.value })
              }
            />
          </label>
          <label>
            Új, négyjegyű aláírókód
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={signing.code}
              onChange={(event) =>
                setSigning({ ...signing, code: event.target.value })
              }
            />
          </label>
          <button type="submit">Aláírókód módosítása</button>
        </form>
      </div>
    </section>
  );
}
