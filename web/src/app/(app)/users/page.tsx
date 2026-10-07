import { CreateUserForm, UserRow } from "@/components/users/UserForms";
import { getAuth } from "@/lib/auth";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireUser("admin");
  const users = getAuth().store.listUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-gray-400">Viewers can see status and logs. Admins can change settings and manage users.</p>
      </div>
      <section className="card space-y-3">
        <h2 className="font-semibold">Add user</h2>
        <CreateUserForm />
      </section>
      <section className="card">
        <h2 className="font-semibold">All users</h2>
        <ul className="divide-y divide-gray-700">
          {users.map((u) => (
            <UserRow key={u.id} user={u} isSelf={u.id === me.user.id} />
          ))}
        </ul>
      </section>
    </div>
  );
}
