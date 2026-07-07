import { redirect } from "next/navigation";

export default function ReferrerDashboardRedirect() {
  redirect("/dashboard/employee");
}
