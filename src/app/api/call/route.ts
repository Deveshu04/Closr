import { NextResponse } from "next/server";
import { placeCall } from "@/lib/bolna";
import { claimDemoCustomer, createCall, getActiveCall, getState, recordMoment, updateCall } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { phone?: string };
  const phone = `+91${(body.phone ?? "").replace(/\D/g, "").slice(-10)}`;
  if (!/^\+91[6-9]\d{9}$/.test(phone)) {
    return NextResponse.json({ ok: false, error: "Enter a 10-digit Indian mobile number" }, { status: 400 });
  }
  // One live call at a time: the demo has a single console, and it caps what a public tunnel can spend.
  const active = getActiveCall();
  if (active && ["dialing", "ringing", "in_progress"].includes(active.status)) {
    return NextResponse.json({ ok: false, error: "A call is already in progress" }, { status: 409 });
  }

  claimDemoCustomer(phone);
  const call = createCall(phone);
  const customer = getState().customers.find((c) => c.id === call.customerId);

  try {
    const { executionId } = await placeCall(call.phone, {
      call_ref: call.callRef,
      customer_name: customer?.name ?? "",
      customer_phone: call.phone,
    });
    updateCall(call.callRef, { bolnaExecutionId: executionId, status: "ringing" });
    recordMoment({
      callRef: call.callRef,
      kind: "call",
      title: "Calling the customer",
      detail: customer ? `${customer.name} · ${call.phone}` : call.phone,
      status: "ok",
    });
    return NextResponse.json({ ok: true, callRef: call.callRef });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Call failed";
    updateCall(call.callRef, { status: "failed", endedAt: new Date().toISOString() });
    recordMoment({ callRef: call.callRef, kind: "call", title: "Call could not be placed", detail: message, status: "failed" });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
