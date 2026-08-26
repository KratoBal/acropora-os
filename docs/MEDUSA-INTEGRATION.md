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

**Not measured yet.** The Medusa source shows no cache on the authentication path
(every request lists keys from the database), which suggests a revoke takes effect
immediately — but _suggests_ is not _measured_, and this page does not record
inferences as facts.

What will be recorded here after the live rotation: whether the refusal was
immediate or delayed, and if delayed, how long it took.

That measurement only counts with its control. A `401` proves nothing on its own
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
