import Experience from "@/components/platform/Experience";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import TaskApp from "./TaskApp";

export const runtime = "nodejs";

async function TasksPage() {
  const member = await getMemberContext(await headers());
  if (!member) redirect("/acceso");
  return <TaskApp />;
}

export default async function Page() {
  return <Experience>{await TasksPage()}</Experience>;
}
