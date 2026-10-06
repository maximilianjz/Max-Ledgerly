import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { handleWebhook } from "../src/lib/whop-webhooks.ts";

const port = 3001;
const instance = randomUUID();
if (process.env.WHOP_WEBHOOK_MODE !== "local" && !process.env.WHOP_WEBHOOK_SECRET) {
  throw new Error("Configure the provider's webhook secret before starting the receiver.");
}
const server = createServer(async (incoming, outgoing) => {
  const parent = incoming.url === "/api/webhooks/whop/parent";
  if ((!parent && incoming.url !== "/api/webhooks/whop") || incoming.method !== "POST") {
    outgoing.writeHead(404).end();
    return;
  }
  try {
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, {
      method: "POST",
      headers: incoming.headers,
      body: Readable.toWeb(incoming),
      duplex: "half",
    });
    const response = await handleWebhook(
      request,
      parent ? { secret: process.env.WHOP_PARENT_WEBHOOK_SECRET ?? "" } : {},
    );
    if (process.env.WHOP_WEBHOOK_MODE === "local") {
      outgoing.setHeader("X-Ledgerly-Receiver-Instance", instance);
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  } catch {
    outgoing.writeHead(500).end();
  }
});
server.requestTimeout = 15_000;
server.on("error", (error) => {
  console.error(`Webhook server could not start: ${error.code || "unknown error"}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Webhook receiver: http://127.0.0.1:${port}/api/webhooks/whop`),
);
process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());
