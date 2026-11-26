import { Logo } from "@/components/Logo";
import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/config";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!isConfigured()) redirect("/setup");
  const { next } = await searchParams;
  return (
    <main className="min-h-full flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <Logo className="text-lg" />
        <h1 className="mt-6 text-xl font-semibold">Design Portal — team sign in</h1>
        <p className="mt-1 mb-6 text-sm text-gray-500">For Evergreen Solar staff. Customers open the link sent to them.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
