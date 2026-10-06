import type { Provider, RequestOptions } from "../src/lib/integration/provider.ts";
import {
  canonical,
  digest,
  IntegrationError,
  type JsonObject,
  object,
} from "../src/lib/integration/store.ts";

// In-memory Whop double for regression tests.
// It has no network transport and never uses a real API key.
export class FixtureProvider implements Provider {
  credentialId = "fixture-credential";
  platformId = "biz_fixtureplatform";
  accounts: JsonObject[] = [];
  checkouts: JsonObject[] = [];
  payments: JsonObject[] = [];
  transfers: JsonObject[] = [];
  calls: { method: string; path: string; options: RequestOptions }[] = [];
  pageSize = 1;
  private cache = new Map<string, { input: string; result: JsonObject }>();
  private linkCount = 0;
  async request(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions = {},
  ): Promise<JsonObject> {
    this.calls.push({ method, path, options });
    if (method === "POST" && options.key) {
      const previous = this.cache.get(options.key);
      if (previous) {
        if (previous.input !== canonical({ path, body: options.body, version: options.version }))
          throw new IntegrationError("idempotency_key_mismatch", "Fixture request changed.");
        return previous.result;
      }
    }
    const body = options.body || {};
    const query = options.query || {};
    let result: JsonObject;
    if (path === "/accounts/me") result = { id: this.platformId, parent_account: null };
    else if (method === "POST" && path === "/accounts") {
      result = {
        ...body,
        id: `biz_fixture${digest(object(body.metadata).external_id).slice(0, 12)}`,
        status: "active",
        parent_account: { id: this.platformId },
      };
      this.accounts.push(result);
    } else if (method === "POST" && path === "/account_links") {
      result = {
        url: `https://whop.com/fixture-onboarding/${body.account_id}/${++this.linkCount}`,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
    } else if (method === "POST" && path === "/checkout_configurations") {
      const suffix = digest(object(body.metadata).ledgerly_order_id).slice(0, 12);
      result = {
        ...body,
        id: `ch_fixture${suffix}`,
        account_id: object(body.plan).company_id,
        plan: { ...object(body.plan), id: `plan_fixture${suffix}` },
        purchase_url: `/checkout/ch_fixture${suffix}/`,
      };
      this.checkouts.push(result);
    } else if (path.startsWith("/accounts/")) {
      const account = this.accounts.find((row) => row.id === path.split("/").pop());
      if (!account) throw new IntegrationError("not_found", "Fixture account not found.");
      result = account;
    } else {
      let rows: JsonObject[];
      if (path === "/accounts") rows = this.accounts;
      else if (path === "/checkout_configurations")
        rows = this.checkouts.filter((row) => row.account_id === query.account_id);
      else if (path === "/payments")
        rows = this.payments.filter((row) => row.account_id === query.account_id);
      else if (path === "/transfers")
        rows = this.transfers.filter((row) =>
          query.destination_id
            ? object(row.destination).id === query.destination_id
            : object(row.origin).id === query.origin_id,
        );
      else
        throw new IntegrationError(
          "unexpected_fixture_request",
          `Unexpected fixture path: ${path}`,
        );
      rows = rows.filter(
        (row) =>
          !query.created_after ||
          (String(row.created_at) > query.created_after &&
            String(row.created_at) < query.created_before),
      );
      const offset = Number(query.after || 0);
      const end = offset + this.pageSize;
      result = {
        data: rows.slice(offset, end),
        page_info: {
          has_next_page: end < rows.length,
          end_cursor: end < rows.length ? String(end) : null,
        },
      };
    }
    if (method === "POST" && options.key)
      this.cache.set(options.key, {
        input: canonical({ path, body: options.body, version: options.version }),
        result,
      });
    return result;
  }
  payment(checkout: JsonObject, id: string, date: string): JsonObject {
    const plan = object(checkout.plan);
    const data = {
      id,
      account_id: checkout.account_id,
      checkout_configuration_id: checkout.id,
      total: { amount: Number(plan.initial_price).toFixed(2), currency: "usd" },
      currency: "usd",
      status: "paid",
      metadata: checkout.metadata,
      created_at: date,
      updated_at: date,
    };
    this.payments.push(data);
    return data;
  }
}
