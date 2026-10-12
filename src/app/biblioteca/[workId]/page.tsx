import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { libraryEnabled } from "@/lib/library/config";
import LibraryApp from "../LibraryApp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function LibraryWorkPage({ params }: { params: Promise<{ workId: string }> }) {
  if (!libraryEnabled()) notFound();
  if (!await getMemberContext(await headers())) redirect("/acceso");
  return <LibraryApp workId={(await params).workId} />;
}
