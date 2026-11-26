import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  redirect(isConfigured() ? "/team" : "/setup");
}
