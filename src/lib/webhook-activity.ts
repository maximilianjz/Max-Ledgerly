import "server-only";
import { paymentOrder } from "@/lib/integration/ledger";
import { IntegrationError, object, type Store } from "@/lib/integration/store";
import { registeredStore } from "@/lib/sellers";
import { listReceipts, type WebhookReceipt } from "@/lib/whop-webhooks";

export type ActivityReceipt = WebhookReceipt & { orderId: string | null; receiptCount: number };

export async function readWebhookActivity(store?: Store): Promise<ActivityReceipt[]> {
  const registry = await registeredStore(store);
  // API recovery snapshots are ledger evidence, not signature-verified webhook deliveries.
  const receipts = (await listReceipts(registry)).filter(
    (receipt) => receipt.source !== "api_recovery",
  );
  const counts = new Map<string, number>();
  for (const receipt of receipts)
    counts.set(receipt.event_id, (counts.get(receipt.event_id) || 0) + 1);
  return Promise.all(
    receipts.reverse().map(async (receipt) => {
      let orderId: string | null = null;
      if (receipt.type.startsWith("payment.")) {
        try {
          orderId = (await paymentOrder(registry, object(receipt.payload.data)))?.orderId || null;
        } catch (error) {
          if (!(error instanceof IntegrationError) || error.code !== "order_conflict") throw error;
        }
      }
      return { ...receipt, orderId, receiptCount: counts.get(receipt.event_id) || 0 };
    }),
  );
}
