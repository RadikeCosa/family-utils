/** Tag identity v1 is independent of recipe-title normalization; ñ stays distinct. */
export function normalizeTagNameV1(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/n\u0303/g, "ñ").replace(/\p{M}/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
}
export function tagCompare(a: string, b: string): number {
  // Compare Unicode code points, also used by PostgreSQL's C collation in UTF-8.
  const aa = Array.from(a), bb = Array.from(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const d = aa[i].codePointAt(0)! - bb[i].codePointAt(0)!;
    if (d) return d;
  }
  return aa.length - bb.length;
}
export function parseTags(value: unknown): { name: string; slug: string }[] {
  if (!Array.isArray(value)) throw new Error("Revisá las etiquetas.");
  const tags = new Map<string, { name: string; slug: string }>();
  for (const raw of value) {
    if (typeof raw !== "string" || !raw.isWellFormed()) throw new Error("Revisá las etiquetas.");
    const name = raw.trim().replace(/^#/, "").trim().replace(/\s+/gu, " ").normalize("NFC");
    const slug = normalizeTagNameV1(name);
    if (!tags.has(slug)) tags.set(slug, { name, slug });
  }
  if (tags.size > 10) throw new Error("La receta admite hasta 10 etiquetas distintas.");
  for (const { name, slug } of tags.values()) {
    if (!name || Array.from(name).length > 40 || !/^[\p{L}\p{M}\p{N} -]+$/u.test(name)) throw new Error("Cada etiqueta admite hasta 40 caracteres: letras, números, espacios y guiones.");
    if (!slug || !/[\p{L}\p{N}]/u.test(slug)) throw new Error("La etiqueta necesita letras o números.");
  }
  return [...tags.values()].sort((a, b) => tagCompare(a.slug, b.slug));
}
