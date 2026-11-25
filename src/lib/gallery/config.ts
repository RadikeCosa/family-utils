// Server entry points only. Keep the feature unavailable until a release is ready.
export function galleryEnabled() {
  return process.env.GALLERY_ENABLED === "true";
}

// Timed public links are released separately because the existing Gallery
// flag may already be enabled in production before the final release phase.
export function gallerySharesEnabled() {
  return galleryEnabled() && process.env.GALLERY_SHARES_ENABLED === "true";
}
