# Reusable integration checks

[Offline demonstration](2026-10-05T23-51-08-234Z-demo.json) exercises the actual backend functions with an in-memory provider and synthetic signed webhook events. It is labeled `source: local_fixture` and `not_a_whop_delivery: true`. It made no Whop requests and moved no money.

Observed results:

- Repeat onboarding returned the same seller through a fresh `LocalStore` instance.
- A $25 direct checkout computed a $2 fee; a platform checkout recorded a $23 seller allocation.
- Replaying an event kept the receipt count at three.
- The Brazilian seller's platform payment and transfer reconciled cleanly.
- Changing only the provider fixture's transfer from $23 to $22 produced an `amountMinor` mismatch.

Repeat with `npm run ledgerly -- demo`. Each run writes its own ignored data directory and timestamped report. Regression tests additionally exercise concurrency, lost create responses, expired retry windows, conflicting identities, out-of-order events, pagination, private response handling, and read-only reconciliation.

The [local webhook commands](../../README.md#local-http-receiver) exercise eight event types and deduplication across an actual receiver process restart. Their generated reports stay local. These checks do not replace real checkout response validation, webhook registration, or Whop test/replay evidence after hosting.
