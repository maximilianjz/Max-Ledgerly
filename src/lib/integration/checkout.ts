import { EXTERNAL_ID } from "../seller-contracts.ts";
import { decimal, priceWithFee, usdMinor } from "./money.ts";
import { assertPlatform, checkRetry, readConnectedAccount } from "./onboarding.ts";
import { CHECKOUT_API_VERSION, listAll, type Provider, trustedWhopUrl } from "./provider.ts";
import {
  type Checkout,
  canonical,
  digest,
  IntegrationError,
  type JsonObject,
  type Operation,
  type Order,
  object,
  type Store,
} from "./store.ts";

export type CheckoutInput = {
  orderId: string;
  sellerExternalId: string;
  title: string;
  amount: string;
  currency: string;
  flow: "direct" | "platform";
  redirectUrl: string;
};

function verifiedCheckout(data: JsonObject, order: Order): Checkout {
  const plan = object(data.plan);
  const metadata = object(data.metadata);
  const accountId = data.account_id ?? data.company_id;
  if (
    accountId !== order.chargeAccountId ||
    (data.account_id && data.company_id && data.account_id !== data.company_id) ||
    typeof data.id !== "string" ||
    !/^ch_[A-Za-z0-9]+$/.test(data.id) ||
    typeof plan.id !== "string" ||
    !/^plan_[A-Za-z0-9]+$/.test(plan.id) ||
    plan.currency !== order.currency ||
    usdMinor(plan.initial_price) !== order.amountMinor ||
    plan.plan_type !== "one_time" ||
    metadata.ledgerly_order_id !== order.orderId ||
    metadata.ledgerly_seller_external_id !== order.sellerExternalId ||
    metadata.ledgerly_fee_minor !== order.feeMinor ||
    metadata.ledgerly_flow !== order.flow
  ) {
    throw new IntegrationError(
      "checkout_mismatch",
      "Whop's checkout does not match the saved order. No checkout was recorded.",
    );
  }
  if (
    order.flow === "direct" &&
    plan.application_fee_amount !== undefined &&
    usdMinor(plan.application_fee_amount) !== order.feeMinor
  ) {
    throw new IntegrationError("fee_mismatch", "Whop returned a different application fee.");
  }
  return {
    orderId: order.orderId,
    id: data.id,
    planId: plan.id,
    purchaseUrl: trustedWhopUrl(data.purchase_url),
  };
}

export async function createCheckout(
  store: Store,
  provider: Provider,
  input: CheckoutInput,
  now = Date.now(),
) {
  if (typeof input?.orderId !== "string" || !EXTERNAL_ID.test(input.orderId))
    throw new IntegrationError("invalid_order", "Provide a stable order ID.");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 120)
    throw new IntegrationError("invalid_title", "Use a product title of 1–120 characters.");
  if (!["direct", "platform"].includes(input.flow))
    throw new IntegrationError("invalid_flow", "Choose direct or platform.");
  const price = priceWithFee(input.amount, input.currency);
  const redirect = new URL(input.redirectUrl);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password)
    throw new IntegrationError(
      "invalid_redirect",
      "Use an HTTPS checkout return URL without credentials.",
    );
  const context = await store.context();
  const seller = await store.seller(input.sellerExternalId);
  await assertPlatform(store, provider);
  const account = await readConnectedAccount(provider, seller);
  if (
    account.id !== seller.accountId ||
    object(account.parent_account).id !== context.platformAccountId ||
    account.status === "suspended"
  ) {
    throw new IntegrationError(
      "seller_unavailable",
      "The connected seller is suspended or no longer belongs to this platform.",
    );
  }
  const order: Order = {
    orderId: input.orderId,
    sellerExternalId: seller.externalId,
    sellerAccountId: seller.accountId,
    chargeAccountId: input.flow === "direct" ? seller.accountId : context.platformAccountId,
    flow: input.flow,
    title: input.title.trim(),
    ...price,
    redirectUrl: redirect.toString(),
  };
  const operation = await store.put<Operation<Order>>("orders", order.orderId, {
    input: order,
    key: `ledgerly-checkout-${digest([context.platformAccountId, order.orderId])}`,
    startedAt: new Date(now).toISOString(),
    credentialId: provider.credentialId,
    apiVersion: CHECKOUT_API_VERSION,
  });
  if (
    canonical(operation.input) !== canonical(order) ||
    operation.apiVersion !== CHECKOUT_API_VERSION
  ) {
    throw new IntegrationError(
      "identity_conflict",
      "This order ID has different checkout inputs. Use its original inputs or a new order ID.",
    );
  }
  const saved = await store.read<Checkout>("checkouts", order.orderId);
  if (saved) return { order, checkout: saved, reused: true };
  const { records } = await listAll(provider, "/checkout_configurations", {
    account_id: order.chargeAccountId,
  });
  const matches = records.filter(
    (record) => object(record.metadata).ledgerly_order_id === order.orderId,
  );
  if (matches.length > 1)
    throw new IntegrationError(
      "duplicate_checkout",
      "Multiple Whop checkouts match this order ID.",
    );
  let data = matches[0];
  if (!data) {
    checkRetry(operation, provider, now);
    data = await provider.request("POST", "/checkout_configurations", {
      key: operation.key,
      version: operation.apiVersion,
      body: {
        plan: {
          company_id: order.chargeAccountId,
          product: {
            title: order.title,
            external_identifier: `ledgerly-${digest(order.orderId).slice(0, 32)}`,
          },
          plan_type: "one_time",
          initial_price: Number(decimal(order.amountMinor)),
          currency: order.currency,
          ...(order.flow === "direct"
            ? { application_fee_amount: Number(decimal(order.feeMinor)) }
            : {}),
        },
        metadata: {
          ledgerly_order_id: order.orderId,
          ledgerly_seller_external_id: seller.externalId,
          ledgerly_flow: order.flow,
          ledgerly_fee_minor: order.feeMinor,
        },
        redirect_url: order.redirectUrl,
      },
    });
  }
  const checkout = await store.exact("checkouts", order.orderId, verifiedCheckout(data, order));
  return { order, checkout, reused: matches.length === 1 };
}
