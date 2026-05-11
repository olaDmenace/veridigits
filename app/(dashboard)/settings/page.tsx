import { redirect } from "next/navigation";
import { logOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";
import {
  ChangeEmailCard,
  ChangePasswordCard,
  DeleteAccountCard,
} from "./settings-forms";

export const metadata = { title: "Settings · Veridigits" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-col gap-8" style={{ maxWidth: 640 }}>
      <div>
        <div className="eyebrow">Settings</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Account
        </h1>
      </div>

      <div className="card flex flex-col gap-4">
        <div>
          <div className="label">Email</div>
          <div className="mono small">{user.email}</div>
        </div>
        <div>
          <div className="label">Account ID</div>
          <div className="mono caption">{user.id}</div>
        </div>
        <form action={logOut}>
          <button type="submit" className="btn btn-secondary">
            Sign out
          </button>
        </form>
      </div>

      <ChangePasswordCard />

      <ChangeEmailCard currentEmail={user.email ?? ""} />

      <DeleteAccountCard />
    </div>
  );
}
