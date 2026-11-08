import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  canonical,
  INITIAL_PLATFORMS,
  parseEnvelope,
  parseMovieReview,
  parsePlatform,
  reviewStale,
  type Availability,
  type AvailabilityCheck,
  type AvailabilityProposal,
  type AvailabilitySummary,
  type CommitResult,
  type CompletedCheck,
  type Platform,
  type ProposalMovie,
  type StreamingOffer,
} from "./availability.ts";
import { familyDay, normalizeLibraryText } from "./rules.ts";

export class AvailabilityError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new AvailabilityError(status, code, message);
};
export type AvailabilityActor = {
  familyId: string;
  memberId: string;
  authUser: { id: string };
};
export async function availabilityActor(
  tx: PoolClient,
  actor: AvailabilityActor,
  admin = false,
) {
  const {
    rows: [row],
  } = await tx.query(
    `SELECT m.role FROM members m JOIN member_devices d ON d.member_id=m.id WHERE m.id=$1 AND m.family_id=$2 AND d.auth_user_id=$3 AND m.archived_at IS NULL AND d.revoked_at IS NULL FOR SHARE OF m,d`,
    [actor.memberId, actor.familyId, actor.authUser.id],
  );
  if (!row) fail(403, "NO_ACCESS", "Tu acceso ya no está disponible.");
  if (admin && row.role !== "administrator")
    fail(
      403,
      "NOT_ADMIN",
      "Solo los administradores pueden mantener las plataformas.",
    );
  return row.role as "member" | "administrator";
}
export async function listPlatforms(
  tx: PoolClient,
  familyId: string,
): Promise<Platform[]> {
  const { rows } = await tx.query(
    `SELECT p.id,p.name,p.modes,p.coverage,p.coverage_sources AS "coverageSources",p.requires_channel AS "requiresChannel",p.version,
    ARRAY(SELECT a.alias FROM streaming_platform_aliases a WHERE a.platform_id=p.id AND a.family_id=p.family_id ORDER BY a.normalized_alias) AS aliases
    FROM streaming_platforms p WHERE p.family_id=$1 ORDER BY p.name,p.id`,
    [familyId],
  );
  return rows;
}
export async function readAvailabilities(
  tx: PoolClient,
  familyId: string,
  workIds: string[],
  today = familyDay(),
): Promise<Map<string, Availability>> {
  const result = new Map(
    workIds.map((id) => [
      id,
      { country: "AR" as const, today, checks: [] as AvailabilityCheck[] },
    ]),
  );
  if (!workIds.length) return result;
  const platforms = new Map(
    (await listPlatforms(tx, familyId)).map((p) => [p.id, p]),
  );
  const { rows } = await tx.query(
    `SELECT c.work_id,c.platform_id,c.checked_on::text,c.source_urls,c.version,
    coalesce(jsonb_agg(jsonb_build_object('mode',o.mode,'sourceUrls',o.source_urls,'linkKind',o.link_kind,'url',o.url,'directVerifiedOn',o.direct_verified_on::text,'channel',o.channel) ORDER BY o.mode) FILTER(WHERE o.id IS NOT NULL),'[]'::jsonb) AS offers
    FROM library_platform_checks c LEFT JOIN library_streaming_offers o ON o.check_id=c.id AND o.family_id=c.family_id
    WHERE c.family_id=$1 AND c.work_id=ANY($2::uuid[]) GROUP BY c.id ORDER BY c.platform_id`,
    [familyId, workIds],
  );
  for (const row of rows) {
    const platform = platforms.get(row.platform_id)!;
    result.get(row.work_id)!.checks.push({
      platformId: row.platform_id,
      outcome: "completed",
      checkedOn: row.checked_on,
      sourceUrls: row.source_urls,
      version: row.version,
      platform,
      offers: row.offers,
      stale: reviewStale(
        row.checked_on,
        row.offers.map((o: StreamingOffer) => o.mode),
        today,
      ),
    });
  }
  return result;
}
export async function availabilitySummary(
  tx: PoolClient,
  familyId: string,
  archived: boolean,
  today = familyDay(),
): Promise<AvailabilitySummary> {
  const platforms = await listPlatforms(tx, familyId);
  const {
    rows: [counts],
  } = await tx.query(
    `SELECT count(*)::int AS total,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM library_platform_checks c WHERE c.work_id=w.id AND c.family_id=w.family_id))::int AS reviewed,
    count(*) FILTER(WHERE EXISTS(SELECT 1 FROM library_platform_checks c WHERE c.work_id=w.id AND c.family_id=w.family_id AND $3::date-c.checked_on >= CASE WHEN NOT EXISTS(SELECT 1 FROM library_streaming_offers o WHERE o.check_id=c.id) OR EXISTS(SELECT 1 FROM library_streaming_offers o WHERE o.check_id=c.id AND o.mode<>'subscription') THEN 14 ELSE 30 END))::int AS stale
    FROM library_works w WHERE w.family_id=$1 AND (w.archived_at IS NOT NULL)=$2`,
    [familyId, archived, today],
  );
  const { rows } = await tx.query(
    `SELECT DISTINCT c.platform_id FROM library_platform_checks c JOIN library_streaming_offers o ON o.check_id=c.id AND o.family_id=c.family_id JOIN library_works w ON w.id=c.work_id AND w.family_id=c.family_id WHERE c.family_id=$1 AND (w.archived_at IS NOT NULL)=$2`,
    [familyId, archived],
  );
  const hasOffers = new Set(rows.map((r) => r.platform_id));
  return {
    ...counts,
    platforms: platforms.map((p) => ({ ...p, hasOffers: hasOffers.has(p.id) })),
  };
}
export function offerFilterSql(platformArg: string | null, free: boolean) {
  return `EXISTS(SELECT 1 FROM library_platform_checks ac JOIN library_streaming_offers ao ON ao.check_id=ac.id AND ao.family_id=ac.family_id WHERE ac.work_id=w.id AND ac.family_id=w.family_id AND ac.country='AR'${platformArg ? ` AND ac.platform_id=ANY(${platformArg}::uuid[])` : ""}${free ? " AND ao.mode IN ('free','free_with_ads')" : ""})`;
}
function completed(check: AvailabilityCheck): CompletedCheck {
  return {
    platformId: check.platformId,
    outcome: "completed",
    checkedOn: check.checkedOn,
    sourceUrls: check.sourceUrls,
    offers: check.offers,
  };
}
function identity(work: {
  title: string;
  year: number | null;
  creator: string | null;
}) {
  return canonical({
    title: work.title,
    year: work.year,
    creator: work.creator,
  });
}
function proposalHash(
  familyId: string,
  memberId: string,
  movies: ProposalMovie[],
) {
  return createHash("sha256")
    .update(
      canonical({
        schemaVersion: 1,
        country: "AR",
        familyId,
        memberId,
        movies,
      }),
    )
    .digest("hex");
}
function validateOffers(check: CompletedCheck, p: Platform) {
  if (check.offers.length && p.coverage !== "verified")
    fail(
      400,
      "COVERAGE",
      "La cobertura de la plataforma todavía no está comprobada para Argentina.",
    );
  if (check.offers.some((o) => !p.modes.includes(o.mode)))
    fail(400, "INVALID", "La plataforma no admite esa modalidad.");
  if (p.requiresChannel && check.offers.some((o) => !o.channel))
    fail(
      400,
      "INVALID",
      "Esta plataforma requiere identificar el canal y su titularidad.",
    );
}

export class AvailabilityStore {
  private pool: Pool;
  private actor: AvailabilityActor;
  constructor(pool: Pool, actor: AvailabilityActor) {
    this.pool = pool;
    this.actor = actor;
  }
  private async transaction<T>(
    run: (tx: PoolClient) => Promise<T>,
    admin = false,
  ): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SET LOCAL lock_timeout='5s'");
      await availabilityActor(tx, this.actor, admin);
      const result = await run(tx);
      await tx.query("COMMIT");
      return result;
    } catch (e) {
      await tx.query("ROLLBACK");
      throw e;
    } finally {
      tx.release();
    }
  }
  private async familyLock(tx: PoolClient) {
    await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [
      this.actor.familyId,
    ]);
  }
  private async audit(
    tx: PoolClient,
    id: string,
    type: string,
    before: unknown,
    after: unknown,
  ) {
    await tx.query(
      `INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,"before","after") VALUES($1,$2,$3,$4,'updated',$5::jsonb,$6::jsonb)`,
      [
        this.actor.familyId,
        this.actor.memberId,
        type,
        id,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );
    await tx.query(
      "UPDATE families SET library_revision=library_revision+1 WHERE id=$1",
      [this.actor.familyId],
    );
  }
  async platforms() {
    return this.transaction(async (tx) => ({
      platforms: await listPlatforms(tx, this.actor.familyId),
      canManage: (await availabilityActor(tx, this.actor)) === "administrator",
    }));
  }
  async availability(workId: string) {
    return this.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT id FROM library_works WHERE id=$1 AND family_id=$2",
        [workId, this.actor.familyId],
      );
      if (!rows.length) fail(404, "NOT_FOUND", "No encontramos la película.");
      return (await readAvailabilities(tx, this.actor.familyId, [workId])).get(
        workId,
      )!;
    });
  }
  private async savePlatform(tx: PoolClient, raw: unknown, editing: boolean) {
    const input = parsePlatform(raw, editing);
    const current = editing
      ? (await listPlatforms(tx, this.actor.familyId)).find(
          (p) => p.id === input.id,
        )
      : undefined;
    if (editing && !current)
      fail(404, "NOT_FOUND", "No encontramos la plataforma.");
    if (current && current.version !== input.expectedVersion)
      fail(409, "CONFLICT", "La plataforma cambió. Volvé a cargarla.");
    if (current) {
      const { rows } = await tx.query(
        `SELECT 1 FROM library_streaming_offers o JOIN library_platform_checks c ON c.id=o.check_id AND c.family_id=o.family_id WHERE c.platform_id=$1 AND c.family_id=$2 AND ($3<>'verified' OR NOT o.mode=ANY($4::text[]) OR ($5 AND o.channel IS NULL)) LIMIT 1`,
        [
          current.id,
          this.actor.familyId,
          input.coverage,
          input.modes,
          input.requiresChannel,
        ],
      );
      if (rows.length)
        fail(
          409,
          "OFFERS_EXIST",
          "Primero retirá las ofertas incompatibles mediante una revisión confirmada.",
        );
    }
    const aliases = [
      ...new Map(
        [...(current ? [current.name] : []), ...input.aliases, input.name].map(
          (a) => [normalizeLibraryText(a), a],
        ),
      ).values(),
    ];
    input.requiresChannel =
      input.requiresChannel ||
      aliases.some((alias) =>
        ["youtube", "youtube oficial"].includes(normalizeLibraryText(alias)),
      );
    const collisions = await tx.query(
      "SELECT 1 FROM streaming_platform_aliases WHERE family_id=$1 AND normalized_alias=ANY($2::text[]) AND ($3::uuid IS NULL OR platform_id<>$3) LIMIT 1",
      [
        this.actor.familyId,
        aliases.map(normalizeLibraryText),
        input.id ?? null,
      ],
    );
    if (collisions.rows.length)
      fail(
        409,
        "DUPLICATE",
        "Ese nombre o alias ya pertenece a otra plataforma.",
      );
    let id = input.id;
    if (current) {
      await tx.query(
        "UPDATE streaming_platforms SET name=$1,modes=$2,coverage=$3,coverage_sources=$4,requires_channel=$5,version=version+1,updated_at=now() WHERE id=$6 AND family_id=$7",
        [
          input.name,
          input.modes,
          input.coverage,
          input.coverageSources,
          input.requiresChannel,
          id,
          this.actor.familyId,
        ],
      );
    } else {
      id = (
        await tx.query(
          "INSERT INTO streaming_platforms(family_id,name,modes,coverage,coverage_sources,requires_channel) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [
            this.actor.familyId,
            input.name,
            input.modes,
            input.coverage,
            input.coverageSources,
            input.requiresChannel,
          ],
        )
      ).rows[0].id;
    }
    await tx.query(
      "DELETE FROM streaming_platform_aliases WHERE platform_id=$1 AND family_id=$2 AND NOT(normalized_alias=ANY($3::text[]))",
      [id, this.actor.familyId, aliases.map(normalizeLibraryText)],
    );
    // Retain the previous display name when a platform is renamed.
    for (const alias of aliases)
      await tx.query(
        "INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES($1,$2,$3,$4) ON CONFLICT(family_id,normalized_alias) DO UPDATE SET alias=excluded.alias",
        [this.actor.familyId, id, alias, normalizeLibraryText(alias)],
      );
    const saved = (await listPlatforms(tx, this.actor.familyId)).find(
      (p) => p.id === id,
    )!;
    await this.audit(tx, id!, "streaming_platform", current ?? null, saved);
    return saved;
  }
  async platform(raw: unknown, editing: boolean) {
    return this.transaction(async (tx) => {
      await this.familyLock(tx);
      return this.savePlatform(tx, raw, editing);
    }, true);
  }
  async initialize() {
    return this.transaction(async (tx) => {
      await this.familyLock(tx);
      const existing = await listPlatforms(tx, this.actor.familyId);
      const aliases = new Set(
        existing.flatMap((p) => p.aliases.map(normalizeLibraryText)),
      );
      for (const p of INITIAL_PLATFORMS)
        if (
          ![p.name, ...p.aliases].some((a) =>
            aliases.has(normalizeLibraryText(a)),
          )
        )
          await this.savePlatform(
            tx,
            {
              ...p,
              coverage: "pending",
              coverageSources: [],
              requiresChannel: "requiresChannel" in p && p.requiresChannel,
            },
            false,
          );
      return { platforms: await listPlatforms(tx, this.actor.familyId) };
    }, true);
  }
  async preview(raw: unknown): Promise<AvailabilityProposal> {
    const inputs = parseEnvelope(raw);
    return this.transaction(async (tx) => {
      // One stable snapshot of identity/catalog/check versions for all proposed movies.
      await this.familyLock(tx);
      const platforms = new Map(
        (await listPlatforms(tx, this.actor.familyId)).map((p) => [p.id, p]),
      );
      const movies: ProposalMovie[] = [];
      for (const rawMovie of inputs) {
        const entry: ProposalMovie = {
          workId: "",
          title: "Película inválida",
          identity: "",
          checks: [],
          expected: {},
          changes: [],
          errors: [],
        };
        try {
          const movie = parseMovieReview(rawMovie);
          entry.workId = movie.workId;
          const {
            rows: [work],
          } = await tx.query(
            "SELECT title,year,creator,archived_at FROM library_works WHERE id=$1 AND family_id=$2",
            [movie.workId, this.actor.familyId],
          );
          if (!work)
            throw new Error("No encontramos esta película en tu familia.");
          entry.title = work.title;
          entry.identity = identity(work);
          if (work.archived_at)
            throw new Error(
              "Restaurá la película antes de revisar su disponibilidad.",
            );
          entry.checks = movie.checks;
          const previous = (
            await readAvailabilities(tx, this.actor.familyId, [movie.workId])
          ).get(movie.workId)!;
          for (const check of movie.checks) {
            const platform = platforms.get(check.platformId);
            if (!platform)
              throw new Error("La plataforma no pertenece a tu familia.");
            const old = previous.checks.find(
              (c) => c.platformId === check.platformId,
            );
            entry.expected[check.platformId] = {
              check: old?.version ?? 0,
              platform: platform.version,
            };
            if (check.outcome === "completed") {
              validateOffers(check, platform);
              const before = old ? completed(old) : null;
              if (canonical(before) !== canonical(check))
                entry.changes.push({
                  platform: platform.name,
                  before,
                  after: check,
                });
            }
          }
        } catch (e) {
          entry.errors.push(
            e instanceof Error ? e.message : "Revisión inválida.",
          );
        }
        movies.push(entry);
      }
      const hash = proposalHash(
        this.actor.familyId,
        this.actor.memberId,
        movies,
      );
      const {
        rows: [saved],
      } = await tx.query(
        "INSERT INTO library_availability_proposals(family_id,member_id,proposal_hash,payload,expires_at) VALUES($1,$2,$3,$4::jsonb,now()+interval '24 hours') RETURNING id,expires_at",
        [
          this.actor.familyId,
          this.actor.memberId,
          hash,
          JSON.stringify(movies),
        ],
      );
      return {
        previewId: saved.id,
        proposalHash: hash,
        expiresAt: saved.expires_at.toISOString(),
        movies,
      };
    });
  }
  async commit(input: {
    previewId: string;
    proposalHash: string;
    idempotencyKey: string;
  }): Promise<{ results: CommitResult[] }> {
    const operation = await this.transaction(async (tx) => {
      const {
        rows: [proposal],
      } = await tx.query(
        "SELECT * FROM library_availability_proposals WHERE id=$1 AND family_id=$2 AND member_id=$3",
        [input.previewId, this.actor.familyId, this.actor.memberId],
      );
      if (!proposal) fail(404, "NOT_FOUND", "No encontramos esta propuesta.");
      if (
        proposal.proposal_hash !== input.proposalHash ||
        proposalHash(
          this.actor.familyId,
          this.actor.memberId,
          proposal.payload,
        ) !== input.proposalHash
      )
        fail(
          409,
          "HASH_MISMATCH",
          "La propuesta no coincide con la vista previa.",
        );
      let {
        rows: [op],
      } = await tx.query(
        "SELECT * FROM library_availability_operations WHERE family_id=$1 AND member_id=$2 AND idempotency_key=$3",
        [this.actor.familyId, this.actor.memberId, input.idempotencyKey],
      );
      if (!op) {
        if (proposal.expires_at.valueOf() <= Date.now())
          fail(
            409,
            "EXPIRED",
            "La propuesta venció. Generá una nueva vista previa.",
          );
        op = (
          await tx.query(
            "INSERT INTO library_availability_operations(family_id,member_id,idempotency_key,preview_id) VALUES($1,$2,$3,$4) ON CONFLICT(family_id,member_id,idempotency_key) DO NOTHING RETURNING *",
            [
              this.actor.familyId,
              this.actor.memberId,
              input.idempotencyKey,
              input.previewId,
            ],
          )
        ).rows[0];
        if (!op)
          op = (
            await tx.query(
              "SELECT * FROM library_availability_operations WHERE family_id=$1 AND member_id=$2 AND idempotency_key=$3",
              [this.actor.familyId, this.actor.memberId, input.idempotencyKey],
            )
          ).rows[0];
      }
      if (op.preview_id !== proposal.id)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Esta clave ya se usó con otra propuesta.",
        );
      return { id: op.id, movies: proposal.payload as ProposalMovie[] };
    });
    const results: CommitResult[] = [];
    for (let index = 0; index < operation.movies.length; index++) {
      const entry = operation.movies[index],
        key = String(index);
      const result = await this.transaction(async (tx) => {
        // Family lock also serializes first checks and platform catalog edits. Released per movie.
        await this.familyLock(tx);
        const {
          rows: [op],
        } = await tx.query(
          "SELECT results FROM library_availability_operations WHERE id=$1 AND family_id=$2 AND member_id=$3 FOR UPDATE",
          [operation.id, this.actor.familyId, this.actor.memberId],
        );
        if (op.results[key]) return op.results[key] as CommitResult;
        let result: CommitResult = {
          workId: entry.workId,
          status: "unchanged",
        };
        if (entry.errors.length)
          result = {
            workId: entry.workId,
            status: "rejected",
            message: entry.errors.join(" "),
          };
        else {
          const {
            rows: [work],
          } = await tx.query(
            "SELECT title,year,creator,archived_at FROM library_works WHERE id=$1 AND family_id=$2 FOR UPDATE",
            [entry.workId, this.actor.familyId],
          );
          const platforms = new Map(
            (await listPlatforms(tx, this.actor.familyId)).map((p) => [
              p.id,
              p,
            ]),
          );
          const previous = (
            await readAvailabilities(tx, this.actor.familyId, [entry.workId])
          ).get(entry.workId)!;
          if (!work || work.archived_at || identity(work) !== entry.identity)
            result = {
              workId: entry.workId,
              status: "conflict",
              message:
                "La película cambió o fue archivada. Generá otra vista previa.",
            };
          else {
            for (const check of entry.checks) {
              const platform = platforms.get(check.platformId),
                old = previous.checks.find(
                  (c) => c.platformId === check.platformId,
                ),
                expected = entry.expected[check.platformId];
              if (
                !platform ||
                platform.version !== expected.platform ||
                (old?.version ?? 0) !== expected.check
              ) {
                result = {
                  workId: entry.workId,
                  status: "conflict",
                  message:
                    "Cambió una plataforma o su revisión. Generá otra vista previa.",
                };
                break;
              }
              if (check.outcome === "completed")
                try {
                  validateOffers(check, platform);
                } catch (e) {
                  result = {
                    workId: entry.workId,
                    status: "rejected",
                    message: (e as Error).message,
                  };
                  break;
                }
            }
            if (result.status === "unchanged") {
              for (const check of entry.checks) {
                if (check.outcome === "failed") continue;
                const old = previous.checks.find(
                  (c) => c.platformId === check.platformId,
                );
                if (canonical(old ? completed(old) : null) === canonical(check))
                  continue;
                const {
                  rows: [saved],
                } = await tx.query(
                  `INSERT INTO library_platform_checks(family_id,work_id,platform_id,checked_on,source_urls,updated_by_member_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(family_id,work_id,country,platform_id) DO UPDATE SET checked_on=excluded.checked_on,source_urls=excluded.source_urls,updated_by_member_id=excluded.updated_by_member_id,updated_at=now(),version=library_platform_checks.version+1 RETURNING id`,
                  [
                    this.actor.familyId,
                    entry.workId,
                    check.platformId,
                    check.checkedOn,
                    check.sourceUrls,
                    this.actor.memberId,
                  ],
                );
                await tx.query(
                  "DELETE FROM library_streaming_offers WHERE check_id=$1 AND family_id=$2",
                  [saved.id, this.actor.familyId],
                );
                for (const o of check.offers)
                  await tx.query(
                    "INSERT INTO library_streaming_offers(family_id,check_id,mode,source_urls,link_kind,url,direct_verified_on,channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
                    [
                      this.actor.familyId,
                      saved.id,
                      o.mode,
                      o.sourceUrls,
                      o.linkKind,
                      o.url,
                      o.directVerifiedOn,
                      o.channel === null ? null : JSON.stringify(o.channel),
                    ],
                  );
                result.status = "applied";
              }
              if (result.status === "applied")
                await this.audit(
                  tx,
                  entry.workId,
                  "library_availability",
                  previous,
                  {
                    checks: entry.checks.filter(
                      (c) => c.outcome === "completed",
                    ),
                    previewId: input.previewId,
                  },
                );
            }
          }
        }
        await tx.query(
          "UPDATE library_availability_operations SET results=jsonb_set(results,ARRAY[$1::text],$2::jsonb) WHERE id=$3",
          [key, JSON.stringify(result), operation.id],
        );
        return result;
      });
      results.push(result);
    }
    return { results };
  }
}
