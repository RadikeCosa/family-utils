import { notFound } from "next/navigation";
import { gallerySharesEnabled } from "@/lib/gallery/config";
import SharedGallery from "./SharedGallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SharedGalleryPage() {
  if (!gallerySharesEnabled()) notFound();
  return <SharedGallery />;
}
