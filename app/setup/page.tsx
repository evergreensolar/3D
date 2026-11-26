import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isConfigured } from "@/lib/config";
import { Logo } from "@/components/Logo";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-time setup" };

export default async function SetupPage() {
  if (isConfigured()) redirect("/login");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return (
    <main className="min-h-full p-4">
      <div className="mx-auto max-w-xl py-6">
        <Logo className="text-lg" />
        <h1 className="mt-6 text-2xl font-semibold">Welcome — let&apos;s set up the Design Portal</h1>
        <p className="mt-1 text-sm text-gray-600">This page appears only once. It connects the portal to your MySQL database, creates all the tables, and creates your admin login.</p>
        <SetupForm defaultAppUrl={`${proto}://${host}`} />
      </div>
    </main>
  );
}
