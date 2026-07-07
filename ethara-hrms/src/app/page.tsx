import { redirect } from "next/navigation";

// The public landing page is the careers portal.
// HRMS staff login is at /login.
export default function RootPage() {
  redirect("/careers");
}
