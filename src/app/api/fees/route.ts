import { jsonResponse } from "@/lib/http";

// Reject requests from old clients too; hiding the editor is not authorization.
export async function PATCH(_request: Request) {
  return jsonResponse(
    {
      error: {
        code: "platform_managed_fees",
        message: "Withdrawal fees are set by Ledgerly and cannot be changed from this workspace.",
      },
    },
    403,
  );
}
