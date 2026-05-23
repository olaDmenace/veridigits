import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LiveOrderView } from "./live-feed";

export const metadata = { title: "Order · Veridigits" };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, phone_number, expires_at, created_at, retail_charged_cents, refund_reason, provider_slug, services(name), countries(name)",
    )
    .eq("id", id)
    .single();

  if (!order || order.user_id !== user.id) {
    notFound();
  }

  const { data: messages } = await supabase
    .from("received_messages")
    .select("id, sender, content, extracted_code, received_at")
    .eq("order_id", id)
    .order("received_at", { ascending: false });

  const service = (order.services as { name: string } | null)?.name ?? "Unknown service";
  const country = (order.countries as { name: string } | null)?.name ?? "—";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/orders" className="caption">
          ← All orders
        </Link>
      </div>

      <LiveOrderView
        order={{
          id: order.id,
          status: order.status,
          phone_number: order.phone_number,
          expires_at: order.expires_at,
          created_at: order.created_at,
          retail_charged_cents: order.retail_charged_cents,
          refund_reason: order.refund_reason,
          service,
          country,
        }}
        initialMessages={messages ?? []}
      />
    </div>
  );
}
