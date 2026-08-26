# Medusa integration: credential path and operations

What this page is for: the Medusa admin credential — where it comes from at
runtime, what the target state is, how it is rotated, and what has actually been
measured about revoking one. Everything here is either measured or explicitly
marked as not measured.

## The credential path

```
database -> env fallback
```

`MedusaCredentialProvider` resolves in that order:

1. **`database`** — the encrypted credential stored on the `MedusaConnectionSetting`
   row, entered through the Settings page. This is the normal path.
2. **`env` fallback** — `MEDUSA_ADMIN_API_KEY` from the process environment, used
   only when the stored credential is absent (`credentialMode = ENV_FALLBACK`).

**The fallback is not silent.** Whoever resolves a credential is told which path it
came from, and the projection command prints one line on stderr when it went the
fallback way. A fallback that works quietly turns a transition into a permanent
state: it keeps working, so nobody notices it is still in use.

**There is no fallback when the stored credential is corrupt.** A damaged envelope
is a configuration and integrity error, not a reason to reach for another secret;
the provider refuses instead of quietly using a different key. That is asserted in
`medusa-credential.provider.spec.ts`.

The address (`MEDUSA_ADMIN_URL`) always comes from the environment and is not a
secret.

### The master key that makes the stored credential readable

Encrypting and decrypting the database credential needs two environment values,
and the API cannot use the stored key without them:

| Variable                               | What it is                         |
| -------------------------------------- | ---------------------------------- |
| `MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION` | which master key version is in use |
| `MEDUSA_CREDENTIAL_MASTER_KEY_V<n>`    | the master key for that version    |

The master key is **32 bytes, base64-encoded**, and the encoding is checked by
round-trip rather than by shape alone, so a truncated or re-wrapped value is
refused instead of producing a key that is almost right. It is **versioned**: the
version travels with the envelope, so an old envelope cannot be opened with a new
key by accident.

Two properties are worth stating plainly because they are easy to assume wrong:

- **It is not the Medusa admin API key.** One protects the other; they rotate on
  different occasions and for different reasons.
- **If it is lost, the stored credential cannot be recovered.** There is no second
  copy and no recovery path — the operational answer is to set a new master key
  and enter the Medusa secret again through the Settings page.

The exact values belong in the deployment's secret store, never in this repository
and never in a shell command.

## Target state

Normal operation: **`database`**.

The env fallback exists for the transition and for rollback. It should not be part
of steady state; see the checklist at the end of the rotation runbook for when it
can be removed from a deployment.

## Rotation

The order is fail-safe, and the point of it is that the old key stays usable until
the new one is proven:

1. create a new Medusa secret key;
2. store it as the database credential (Settings page);
3. confirm `source = database`;
4. read probe green;
5. projection green;
6. **only then** revoke the old key;
7. verify that the old key is refused.

Step-by-step commands: `docs/RUNBOOK-MEDUSA-CREDENTIAL-ROTATION.md`.

Never revoke before step 5. If any step is not green, the revoke does not follow —
that is the one irreversible action in the sequence.

## Revoke behaviour

**The rotation was performed on 2026-08-26, and one half of the measurement was
made while the other was not. Both halves are stated here, because the difference
is the whole point.**

What was measured:

- the old Medusa secret key was revoked;
- after the revoke, a projection using the new, database-stored credential still
  succeeded (`updated -> prod_01M0Z9TAYE7KV7YM3YHMR9YGF3`).

What was **not** measured:

- a direct HTTP request carrying the revoked old key. The plaintext of the old key
  was no longer available, so the call could not be made.

So the refusal of a revoked key has still not been observed. What the round does
establish is that the system no longer depends on the old key: the work continues
on the new credential after the revoke. That is strong indirect evidence, and it
is not the same claim — a system can keep working on a new key while an old one
remains just as usable as before.

**Do not promote this to "revoke propagation proven."** The evidence supports
"the new credential carries the traffic", not "the old credential is refused".
The direct measurement (runbook step 5.2, with its 5.1 control) remains open, and
the next rotation can close it by keeping the outgoing key readable until step 5.2
has run.

When it is finally made, that measurement only counts with its control. A `401`
proves nothing on its own
— a mistyped address or a malformed basic-auth header produces exactly the same
answer, and from outside the two are indistinguishable. So the runbook measures
the **new** key first on the same path: once that returns `200`, the shape of the
call is proven, and the old key's `401` is about the key rather than about the
question.

## Permission enforcement — a compatibility constraint

> Turning on Medusa's permission enforcement (`rbac`) may be a breaking change for
> the Acropora OS machine integration.

The secret key is full-privilege and carries no role. With enforcement on, our
calls would receive `403` even though the key is intact. Anyone changing the
commerce configuration should treat this as a known dependency, not as a risk to
be discovered later.

## Reading an HTTP refusal

A `401` or `403` from Medusa **does not by itself prove a bad key**:

- `403` today can only come from the permission check, but that sits behind the
  `rbac` flag, and the reverse proxy in front of Medusa could also produce one;
- `401` comes from a single place, but five different causes lead there, and one of
  them is not about the key at all: Medusa catches its own api-key module's
  exception, so a database error on that side arrives as `401`.

Consequences, both deliberate:

- the integration state names the two together (`auth-or-permission-failure`), and
  the message says both possible causes in one sentence;
- **no automatic credential rotation on a status code alone.** A rotation triggered
  by a `401` would, in the failure mode above, replace a healthy key while the real
  fault stays where it is.

## Where the assertions live

| Claim                                                              | Where it is asserted                         |
| ------------------------------------------------------------------ | -------------------------------------------- |
| the four integration states stay distinct                          | `medusa-connection.service.spec.ts`          |
| no fallback when the stored credential is corrupt                  | `medusa-credential.provider.spec.ts`         |
| projection works from the stored key with no env key               | `medusa-projection.cli.spec.ts`              |
| a missing key is still visible as `not-configured`                 | `medusa-admin.config.spec.ts`                |
| the secret is not read from the environment on the projection path | `medusa-projection.cli.spec.ts` (structural) |

**A claim with an expiry condition, not a date.** Two Medusa integration specs
(`medusa-connection.repository.integration.spec.ts`,
`medusa-product-link.integration.spec.ts`) were written but named in no runner
list, so they ran nowhere.

The condition is checkable in one command, and it is the condition — not this
paragraph — that decides:

```bash
grep -c 'medusa-connection.repository.integration.spec.js' apps/api/package.json
```

- **`0`** — the specs still run nowhere, and "the Medusa integration tests are
  green" is an assumption rather than a statement.
- **`1`** — they run with the rest, and this paragraph no longer applies.

A date here would read just as confidently a month from now, and by then it could
be false. A condition cannot: it answers for itself.
