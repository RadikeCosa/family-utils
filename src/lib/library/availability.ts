import { familyDay, normalizeLibraryText, UUID_PATTERN } from "./rules.ts";

export const OFFER_MODES = ["subscription", "free", "free_with_ads"] as const;
export type OfferMode = (typeof OFFER_MODES)[number];
export const MODE_LABELS: Record<OfferMode, string> = {
  subscription: "Con suscripción",
  free: "Gratis",
  free_with_ads: "Gratis con publicidad",
};
export type Coverage = "pending" | "verified" | "unavailable";
export type Channel = { name: string; url: string; authoritySourceUrl: string };
export type StreamingOffer = {
  mode: OfferMode;
  sourceUrls: string[];
  linkKind: "direct" | "aggregator" | "none";
  url: string | null;
  directVerifiedOn: string | null;
  channel: Channel | null;
};
export type Platform = {
  id: string;
  name: string;
  aliases: string[];
  modes: OfferMode[];
  coverage: Coverage;
  coverageSources: string[];
  requiresChannel: boolean;
  version: number;
};
export type CompletedCheck = {
  platformId: string;
  outcome: "completed";
  checkedOn: string;
  sourceUrls: string[];
  offers: StreamingOffer[];
};
export type FailedCheck = {
  platformId: string;
  outcome: "failed";
  reason: string;
  findings?: string;
};
export type MovieReview = {
  workId: string;
  checks: (CompletedCheck | FailedCheck)[];
};
export type AvailabilityCheck = CompletedCheck & {
  platform: Platform;
  version: number;
  stale: boolean;
};
export type Availability = {
  country: "AR";
  today: string;
  checks: AvailabilityCheck[];
};
export type AvailabilitySummary = {
  total: number;
  reviewed: number;
  stale: number;
  platforms: (Platform & { hasOffers: boolean })[];
};
export type ProposalMovie = {
  workId: string;
  title: string;
  identity: string;
  checks: MovieReview["checks"];
  expected: Record<string, { check: number; platform: number }>;
  changes: {
    platform: string;
    before: CompletedCheck | null;
    after: CompletedCheck;
  }[];
  errors: string[];
};
export type AvailabilityProposal = {
  previewId: string;
  proposalHash: string;
  expiresAt: string;
  movies: ProposalMovie[];
};
export type CommitResult = {
  workId: string;
  status: "applied" | "unchanged" | "conflict" | "rejected";
  message?: string;
};

export const INITIAL_PLATFORMS = [
  { name: "Netflix", aliases: [], modes: ["subscription"] },
  { name: "Disney+", aliases: ["Disney Plus"], modes: ["subscription"] },
  { name: "Paramount+", aliases: ["Paramount Plus"], modes: ["subscription"] },
  { name: "HBO Max", aliases: ["Max"], modes: ["subscription"] },
  {
    name: "Prime Video",
    aliases: ["Amazon Prime Video"],
    modes: ["subscription"],
  },
  { name: "MUBI", aliases: [], modes: ["subscription"] },
  { name: "Apple TV+", aliases: ["Apple TV Plus"], modes: ["subscription"] },
  { name: "Pluto TV", aliases: ["Pluto"], modes: ["free_with_ads"] },
  { name: "Plex", aliases: [], modes: ["free_with_ads"] },
  { name: "Fawesome", aliases: ["Fawesome TV"], modes: ["free_with_ads"] },
  {
    name: "YouTube oficial",
    aliases: ["YouTube"],
    modes: ["free", "free_with_ads"],
    requiresChannel: true,
  },
  {
    name: "CINE.AR Play",
    aliases: ["Cinear Play", "Cine Ar Play"],
    modes: ["free"],
  },
] as const;

export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
export function httpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /\s/u.test(value))
    return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function urls(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 20 &&
    value.every(httpUrl) &&
    new Set(value).size === value.length
  );
}
function bounded(value: unknown, max = 500): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= max
  );
}
export function validReviewDate(
  value: unknown,
  today = familyDay(),
): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01" ||
    value > today
  )
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
export function reviewStale(
  checkedOn: string,
  modes: OfferMode[],
  today = familyDay(),
) {
  const days = Math.floor(
    (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${checkedOn}T12:00:00Z`)) /
      86400000,
  );
  return (
    days >=
    (modes.length === 0 || modes.some((mode) => mode !== "subscription")
      ? 14
      : 30)
  );
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function parseOffer(value: unknown, checkedOn: string): StreamingOffer {
  if (
    !object(value) ||
    !keys(value, [
      "mode",
      "sourceUrls",
      "linkKind",
      "url",
      "directVerifiedOn",
      "channel",
    ]) ||
    !OFFER_MODES.includes(value.mode as OfferMode) ||
    !urls(value.sourceUrls)
  )
    throw new Error("Revisá la modalidad y las fuentes de la oferta.");
  const { linkKind, url, directVerifiedOn, channel } = value;
  if (
    linkKind === "none"
      ? url !== null || directVerifiedOn !== null
      : linkKind === "aggregator"
        ? !httpUrl(url) || directVerifiedOn !== null
        : linkKind === "direct"
          ? !httpUrl(url) || !validReviewDate(directVerifiedOn, checkedOn)
          : true
  )
    throw new Error(
      "El enlace y su comprobación no corresponden al tipo de enlace.",
    );
  if (
    channel !== null &&
    (!object(channel) ||
      !keys(channel, ["name", "url", "authoritySourceUrl"]) ||
      !bounded(channel.name, 200) ||
      !httpUrl(channel.url) ||
      !httpUrl(channel.authoritySourceUrl))
  )
    throw new Error("Indicá el canal y la fuente que acredita su titularidad.");
  return {
    mode: value.mode as OfferMode,
    sourceUrls: [...value.sourceUrls].sort(),
    linkKind: linkKind as StreamingOffer["linkKind"],
    url: url as string | null,
    directVerifiedOn: directVerifiedOn as string | null,
    channel: channel as Channel | null,
  };
}
export function parseMovieReview(
  value: unknown,
  today = familyDay(),
): MovieReview {
  if (
    !object(value) ||
    !keys(value, ["workId", "checks"]) ||
    typeof value.workId !== "string" ||
    !UUID_PATTERN.test(value.workId) ||
    !Array.isArray(value.checks) ||
    !value.checks.length ||
    value.checks.length > 100
  )
    throw new Error("Película o revisiones inválidas.");
  const seen = new Set<string>();
  const checks = value.checks
    .map((check) => {
      if (
        !object(check) ||
        typeof check.platformId !== "string" ||
        !UUID_PATTERN.test(check.platformId) ||
        seen.has(check.platformId.toLowerCase())
      )
        throw new Error("Plataforma inválida o repetida.");
      const platformId = check.platformId.toLowerCase();
      seen.add(platformId);
      if (check.outcome === "failed") {
        if (
          !keys(check, ["platformId", "outcome", "reason", "findings"]) ||
          !bounded(check.reason, 1000) ||
          (check.findings !== undefined && !bounded(check.findings, 2000))
        )
          throw new Error(
            "Una consulta fallida requiere un motivo, sin ofertas.",
          );
        return {
          platformId,
          outcome: "failed" as const,
          reason: check.reason.trim(),
          ...(check.findings === undefined
            ? {}
            : { findings: (check.findings as string).trim() }),
        };
      }
      if (
        !keys(check, [
          "platformId",
          "outcome",
          "checkedOn",
          "sourceUrls",
          "offers",
        ]) ||
        check.outcome !== "completed" ||
        !validReviewDate(check.checkedOn, today) ||
        !urls(check.sourceUrls) ||
        !Array.isArray(check.offers) ||
        check.offers.length > 3
      )
        throw new Error(
          "La revisión completada requiere fecha válida, fuentes y ofertas.",
        );
      const checkedOn = check.checkedOn;
      const offers = check.offers
        .map((offer) => parseOffer(offer, checkedOn))
        .sort((a, b) => a.mode.localeCompare(b.mode));
      if (new Set(offers.map((offer) => offer.mode)).size !== offers.length)
        throw new Error(
          "No se puede repetir una modalidad en la misma plataforma.",
        );
      return {
        platformId,
        outcome: "completed" as const,
        checkedOn,
        sourceUrls: [...check.sourceUrls].sort(),
        offers,
      };
    })
    .sort((a, b) => a.platformId.localeCompare(b.platformId));
  return { workId: value.workId.toLowerCase(), checks };
}
export function parseEnvelope(value: unknown): unknown[] {
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "country", "movies"]) ||
    value.schemaVersion !== 1 ||
    value.country !== "AR" ||
    !Array.isArray(value.movies) ||
    !value.movies.length ||
    value.movies.length > 100
  )
    throw new Error(
      "Usá schemaVersion 1, country AR y entre 1 y 100 películas.",
    );
  const ids = value.movies
    .filter(object)
    .map((movie) =>
      typeof movie.workId === "string" ? movie.workId.toLowerCase() : null,
    )
    .filter(Boolean);
  if (new Set(ids).size !== ids.length)
    throw new Error("Hay películas repetidas en la carga.");
  return value.movies;
}
export function parsePlatform(value: unknown, editing: boolean) {
  if (
    !object(value) ||
    !keys(value, [
      "id",
      "expectedVersion",
      "name",
      "aliases",
      "modes",
      "coverage",
      "coverageSources",
      "requiresChannel",
    ]) ||
    !bounded(value.name, 100) ||
    !Array.isArray(value.aliases) ||
    value.aliases.length > 30 ||
    !value.aliases.every((alias) => bounded(alias, 100)) ||
    !Array.isArray(value.modes) ||
    !value.modes.length ||
    !value.modes.every((mode) => OFFER_MODES.includes(mode as OfferMode)) ||
    new Set(value.modes).size !== value.modes.length ||
    !["pending", "verified", "unavailable"].includes(String(value.coverage)) ||
    typeof value.requiresChannel !== "boolean"
  )
    throw new Error(
      "Revisá el nombre, alias, modalidades y cobertura de la plataforma.",
    );
  if (
    !Array.isArray(value.coverageSources) ||
    value.coverageSources.length > 20 ||
    !value.coverageSources.every(httpUrl) ||
    (value.coverage === "verified" && !value.coverageSources.length)
  )
    throw new Error("La cobertura comprobada requiere al menos una fuente.");
  if (
    editing
      ? typeof value.id !== "string" ||
        !UUID_PATTERN.test(value.id) ||
        !Number.isInteger(value.expectedVersion) ||
        Number(value.expectedVersion) < 1
      : value.id !== undefined || value.expectedVersion !== undefined
  )
    throw new Error("Versión de plataforma inválida.");
  const aliases = [
    ...new Map(
      [value.name, ...value.aliases].map((alias) => [
        normalizeLibraryText(alias as string),
        (alias as string).trim().replace(/\s+/gu, " "),
      ]),
    ).values(),
  ];
  return {
    id: value.id as string | undefined,
    expectedVersion: value.expectedVersion as number | undefined,
    name: value.name.trim().replace(/\s+/gu, " "),
    aliases,
    modes: [...value.modes].sort() as OfferMode[],
    coverage: value.coverage as Coverage,
    coverageSources: [...value.coverageSources].sort() as string[],
    requiresChannel: value.requiresChannel,
  };
}
