import Dashboard from "@/components/Dashboard";
import { getStats } from "@/lib/players";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const stats = await getStats();
  return (
    <main className="min-h-screen">
      <Dashboard initialStats={stats} />
    </main>
  );
}
