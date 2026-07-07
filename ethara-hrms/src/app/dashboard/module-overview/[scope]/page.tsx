import { notFound } from "next/navigation";
import { ModuleDashboard, type ModuleDashboardScope } from "../module-dashboard-client";

const SCOPES: ModuleDashboardScope[] = ["talent", "lifecycle", "performance", "it-operations", "finance"];

export default async function ScopedModuleDashboardPage({ params }: { params: Promise<{ scope: string }> }) {
  const { scope } = await params;
  if (!SCOPES.includes(scope as ModuleDashboardScope)) notFound();
  return <ModuleDashboard scope={scope as ModuleDashboardScope} />;
}
