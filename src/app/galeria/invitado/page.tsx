import GuestGallery from "./GuestGallery";
import { notFound } from "next/navigation";
import { galleryEnabled } from "@/lib/gallery/config";

export const dynamic = "force-dynamic";

export default function GuestGalleryPage() {
  if (!galleryEnabled()) notFound();
  return <GuestGallery />;
}
