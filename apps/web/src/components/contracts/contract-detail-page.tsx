"use client";

import { Alert, Button, Card, Input, Select } from "@acropora/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contractsApi, type ContractSummary } from "@/lib/api/contracts";

export function ContractDetailPage({ contractId }: { contractId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [contract, setContract] = useState<ContractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setContract(await contractsApi.detail(token, contractId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A szerződés nem tölthető be.",
      );
    }
  };
  useEffect(() => {
    if (token) void load();
  }, [contractId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!contract) return;
    setSaving(true);
    setError(null);
    try {
      const next = await contractsApi.update(token, contract.id, {
        number: contract.number,
        title: contract.title,
        validFrom: contract.validFrom,
        validTo: contract.validTo ?? null,
        status: contract.status,
        notes: contract.notes ?? null,
      });
      setContract(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A szerződés nem menthető.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (error && !contract)
    return (
      <Alert variant="danger" title="Betöltési hiba" description={error} />
    );
  if (!contract)
    return <p className="text-sm text-muted">Szerződés betöltése…</p>;
  return (
    <div className="space-y-6">
      <Link className="text-sm underline" href="/partnerek/szerzodesek">
        ← Szerződések
      </Link>
      <div>
        <p className="text-sm text-muted">{contract.customer.displayName}</p>
        <h1 className="text-2xl font-semibold">{contract.number}</h1>
      </div>
      {error ? (
        <Alert variant="danger" title="Mentési hiba" description={error} />
      ) : null}
      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">Szerződés adatai</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            aria-label="Szerződésszám"
            value={contract.number}
            onChange={(event) =>
              setContract({ ...contract, number: event.target.value })
            }
          />
          <Input
            aria-label="Szerződés címe"
            value={contract.title}
            onChange={(event) =>
              setContract({ ...contract, title: event.target.value })
            }
          />
          <Input
            type="date"
            aria-label="Érvényes ettől"
            value={contract.validFrom.slice(0, 10)}
            onChange={(event) =>
              setContract({ ...contract, validFrom: event.target.value })
            }
          />
          <Input
            type="date"
            aria-label="Érvényes eddig"
            value={contract.validTo?.slice(0, 10) ?? ""}
            onChange={(event) =>
              setContract({ ...contract, validTo: event.target.value || null })
            }
          />
          <Select
            aria-label="Állapot"
            value={contract.status}
            onChange={(event) =>
              setContract({
                ...contract,
                status: event.target.value as ContractSummary["status"],
              })
            }
          >
            <option value="DRAFT">Piszkozat</option>
            <option value="ACTIVE">Aktív</option>
            <option value="EXPIRED">Lejárt</option>
            <option value="TERMINATED">Megszűnt</option>
          </Select>
        </div>
        <Input
          aria-label="Megjegyzés"
          value={contract.notes ?? ""}
          onChange={(event) =>
            setContract({ ...contract, notes: event.target.value || null })
          }
        />
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? "Mentés…" : "Módosítások mentése"}
        </Button>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-lg font-semibold">Szerződéses tételek</h2>
        <ul className="space-y-2 text-sm">
          {contract.items.map((item) => (
            <li key={item.id}>
              {item.position}. {item.description} — {item.unitNet} Ft ×{" "}
              {item.quantity} db × {item.occasionsPerYear} alkalom / év,{" "}
              {item.vatRatePercent}% ÁFA
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
