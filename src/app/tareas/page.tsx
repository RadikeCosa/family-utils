import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import TaskApp from "./TaskApp";

export const runtime = "nodejs";

export default async function TasksPage() {
  const member = await getMemberContext(await headers());
  if (!member) redirect("/acceso");
  return <TaskApp />;
}
