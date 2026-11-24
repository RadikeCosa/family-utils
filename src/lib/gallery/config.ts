// Server entry points only. Keep the feature unavailable until a release is ready.
export function galleryEnabled() {
  return process.env.GALLERY_ENABLED === "true";
}
