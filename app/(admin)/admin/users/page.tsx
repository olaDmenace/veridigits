import { getAdminClient } from "@/lib/supabase/admin";
import { UsersTable, type AdminUserRow } from "./users-table";

export const metadata = { title: "Users · Admin" };

export default async function AdminUsersPage() {
  const admin = getAdminClient();

  // Pull profiles + match against auth.users via the service role.
  // auth.users is not exposed to the standard supabase-js client, so we
  // use admin.auth.admin.listUsers() to fetch emails.
  const { data: profiles } = await admin
    .from("profiles")
    .select(
      "id, wallet_balance_cents, total_spent_cents, total_topped_up_cents, is_admin, is_banned, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: authList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const emailById = new Map(
    (authList?.users ?? []).map((u) => [u.id, u.email ?? null] as const),
  );

  const rows: AdminUserRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: emailById.get(p.id) ?? null,
    walletBalanceCents: p.wallet_balance_cents,
    totalSpentCents: p.total_spent_cents,
    totalToppedUpCents: p.total_topped_up_cents,
    isAdmin: p.is_admin,
    isBanned: p.is_banned,
    createdAt: p.created_at,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Users
        </h1>
        <p className="body" style={{ marginTop: 14 }}>
          Search, ban, and manually adjust wallet balances. Adjustments post
          to the ledger as <span className="mono">type=adjustment</span>.
        </p>
      </div>

      <UsersTable users={rows} />
    </div>
  );
}
