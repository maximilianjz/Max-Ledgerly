# Reusable integration checks

[Offline demonstration](2026-10-05T23-51-08-234Z-demo.json) exercises the actual backend functions with an in-memory provider and synthetic signed webhook events. It is labeled `source: local_fixture` and `not_a_whop_delivery: true`. It made no Whop requests and moved no money.

Observed results:

- Repeat onboarding returned the same seller through a fresh `LocalStore` instance.
- A $25 direct checkout computed a $2 fee; a platform checkout recorded a $23 seller allocation.
- Replaying an event kept the receipt count at three.
- The Brazilian seller's platform payment and transfer reconciled cleanly.
- Changing only the provider fixture's transfer from $23 to $22 produced an `amountMinor` mismatch.

These reports are historical fixtures. Current regression coverage runs with `npm test`, including concurrent onboarding, lost create responses, expired retry windows, conflicting identities, all eight webhook event types, replay through fresh store instances, pagination, private response handling, and read-only reconciliation.

Fixture checks do not replace real checkout response validation, webhook registration, or Whop test/replay evidence after hosting. Follow the [deployed test and replay steps](../../docs/operations.md#test-and-replay) for that evidence.
