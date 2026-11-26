import Link from "next/link";
import { requireTeamUser } from "@/lib/auth/session";
import { logout } from "@/app/login/actions";
import { Logo } from "@/components/Logo";

// Never pre-render team pages at build time (the database is configured at runtime via /setup).
export const dynamic = "force-dynamic";

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const user = await requireTeamUser();
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Link href="/team"><Logo className="text-sm" /></Link>
          <span className="hidden rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 sm:inline">Design Portal</span>
          <nav className="ml-auto flex items-center gap-1">
            <Link href="/team" className="btn-ghost px-2 py-2 sm:px-3">Projects</Link>
            <Link href="/team/calendar" className="btn-ghost px-2 py-2 sm:px-3">Calendar</Link>
            <Link href="/team/availability" className="btn-ghost hidden px-3 py-2 sm:inline-flex">Availability</Link>
            {user.role === "ADMIN" && <Link href="/team/library" className="btn-ghost hidden px-3 py-2 sm:inline-flex">Library</Link>}
            {user.role === "ADMIN" && <Link href="/team/users" className="btn-ghost hidden px-3 py-2 sm:inline-flex">Team</Link>}
            {user.role !== "SALES" && <Link href="/team/projects/new" className="btn-primary px-3 py-2">+ New</Link>}
            <form action={logout}>
              <button className="btn-ghost px-3 py-2" title={`${user.name} (${user.role.toLowerCase()})`}>Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
