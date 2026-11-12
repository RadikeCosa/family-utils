import { getFamilyDay } from "./family-day.ts";

export function effectiveTaskDate(dueDate: string | null, createdAt: Date): string {
  return dueDate ?? getFamilyDay(createdAt);
}

type DailyItem = { status: string; effectiveDate: string; scheduledTime: string | null; completedAt: Date | null; key: string };
export function compareDailyTasks(a: DailyItem, b: DailyItem): number {
  const completed = Number(a.status === "completed") - Number(b.status === "completed");
  if (completed) return completed;
  if (a.status === "completed" && b.status === "completed") return (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0) || a.key.localeCompare(b.key);
  return a.effectiveDate.localeCompare(b.effectiveDate) || (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? "") || a.key.localeCompare(b.key);
}
