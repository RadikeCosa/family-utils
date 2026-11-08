SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
CREATE FUNCTION availability_urls_valid(urls text[], allow_empty boolean) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
SELECT urls IS NOT NULL AND cardinality(urls) BETWEEN CASE WHEN allow_empty THEN 0 ELSE 1 END AND 20
AND (cardinality(urls)=0 OR array_ndims(urls)=1)
AND NOT EXISTS(SELECT 1 FROM unnest(urls) u WHERE u IS NULL OR char_length(u)>2048 OR u !~* '^https?://[^[:space:]/@]+[^[:space:]]*$');
$$;
--> statement-breakpoint
CREATE FUNCTION availability_channel_valid(channel jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
SELECT coalesce(CASE WHEN jsonb_typeof(channel)='object' THEN
 jsonb_typeof(channel->'name')='string' AND char_length(btrim(channel->>'name')) BETWEEN 1 AND 200
 AND jsonb_typeof(channel->'url')='string' AND jsonb_typeof(channel->'authoritySourceUrl')='string'
 AND availability_urls_valid(ARRAY[channel->>'url',channel->>'authoritySourceUrl'],false)
 AND channel - ARRAY['name','url','authoritySourceUrl']::text[] = '{}'::jsonb
 ELSE false END,false);
$$;
--> statement-breakpoint
CREATE TABLE "library_availability_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"preview_id" uuid NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_availability_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"proposal_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "availability_proposal_hash" CHECK ("library_availability_proposals"."proposal_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "availability_proposal_expiry" CHECK ("library_availability_proposals"."expires_at">"library_availability_proposals"."created_at")
);
--> statement-breakpoint
CREATE TABLE "library_platform_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"country" text DEFAULT 'AR' NOT NULL,
	"checked_on" date NOT NULL,
	"source_urls" text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_checks_country" CHECK ("library_platform_checks"."country"='AR'),
	CONSTRAINT "library_checks_date" CHECK ("library_platform_checks"."checked_on" BETWEEN DATE '0001-01-01' AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date),
	CONSTRAINT "library_checks_sources" CHECK (availability_urls_valid("library_platform_checks"."source_urls",false)),
	CONSTRAINT "library_checks_version" CHECK ("library_platform_checks"."version">0)
);
--> statement-breakpoint
CREATE TABLE "library_streaming_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"source_urls" text[] NOT NULL,
	"link_kind" text NOT NULL,
	"url" text,
	"direct_verified_on" date,
	"channel" jsonb,
	CONSTRAINT "library_offers_mode" CHECK ("library_streaming_offers"."mode" IN ('subscription','free','free_with_ads')),
	CONSTRAINT "library_offers_sources" CHECK (availability_urls_valid("library_streaming_offers"."source_urls",false)),
	CONSTRAINT "library_offers_link" CHECK (("library_streaming_offers"."link_kind"='none' AND "library_streaming_offers"."url" IS NULL AND "library_streaming_offers"."direct_verified_on" IS NULL) OR ("library_streaming_offers"."link_kind"='aggregator' AND "library_streaming_offers"."url" IS NOT NULL AND availability_urls_valid(ARRAY["library_streaming_offers"."url"],false) AND "library_streaming_offers"."direct_verified_on" IS NULL) OR ("library_streaming_offers"."link_kind"='direct' AND "library_streaming_offers"."url" IS NOT NULL AND availability_urls_valid(ARRAY["library_streaming_offers"."url"],false) AND "library_streaming_offers"."direct_verified_on" IS NOT NULL)),
	CONSTRAINT "library_offers_channel" CHECK ("library_streaming_offers"."channel" IS NULL OR availability_channel_valid("library_streaming_offers"."channel"))
);
--> statement-breakpoint
CREATE TABLE "streaming_platform_aliases" (
	"family_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	CONSTRAINT "streaming_alias_length" CHECK (char_length(btrim("streaming_platform_aliases"."alias")) BETWEEN 1 AND 100 AND char_length(btrim("streaming_platform_aliases"."normalized_alias")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "streaming_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"modes" text[] NOT NULL,
	"coverage" text DEFAULT 'pending' NOT NULL,
	"coverage_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"requires_channel" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streaming_platforms_name" CHECK (char_length(btrim("streaming_platforms"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "streaming_platforms_modes" CHECK (cardinality("streaming_platforms"."modes") BETWEEN 1 AND 3 AND array_ndims("streaming_platforms"."modes")=1 AND "streaming_platforms"."modes" <@ ARRAY['subscription','free','free_with_ads']::text[] AND array_position("streaming_platforms"."modes",NULL) IS NULL AND cardinality("streaming_platforms"."modes")=num_nonnulls(array_position("streaming_platforms"."modes",'subscription'),array_position("streaming_platforms"."modes",'free'),array_position("streaming_platforms"."modes",'free_with_ads'))),
	CONSTRAINT "streaming_platforms_coverage" CHECK ("streaming_platforms"."coverage" IN ('pending','verified','unavailable') AND ("streaming_platforms"."coverage"<>'verified' OR cardinality("streaming_platforms"."coverage_sources")>0)),
	CONSTRAINT "streaming_platforms_version" CHECK ("streaming_platforms"."version">0),
	CONSTRAINT "streaming_platforms_sources" CHECK (availability_urls_valid("streaming_platforms"."coverage_sources",true))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "availability_operations_key" ON "library_availability_operations" USING btree ("family_id","member_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "availability_proposals_owner" ON "library_availability_proposals" USING btree ("id","family_id","member_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "library_checks_identity" ON "library_platform_checks" USING btree ("family_id","work_id","country","platform_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "library_checks_id_family" ON "library_platform_checks" USING btree ("id","family_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "library_offers_check_mode" ON "library_streaming_offers" USING btree ("check_id","mode");
--> statement-breakpoint
CREATE UNIQUE INDEX "streaming_alias_family_unique" ON "streaming_platform_aliases" USING btree ("family_id","normalized_alias");
--> statement-breakpoint
CREATE UNIQUE INDEX "streaming_platforms_id_family" ON "streaming_platforms" USING btree ("id","family_id");
--> statement-breakpoint
ALTER TABLE "library_availability_operations" ADD CONSTRAINT "library_availability_operations_preview_id_family_id_member_id_library_availability_proposals_id_family_id_member_id_fk" FOREIGN KEY ("preview_id","family_id","member_id") REFERENCES "public"."library_availability_proposals"("id","family_id","member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_availability_proposals" ADD CONSTRAINT "library_availability_proposals_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_platform_checks" ADD CONSTRAINT "library_platform_checks_work_id_family_id_library_works_id_family_id_fk" FOREIGN KEY ("work_id","family_id") REFERENCES "public"."library_works"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_platform_checks" ADD CONSTRAINT "library_platform_checks_platform_id_family_id_streaming_platforms_id_family_id_fk" FOREIGN KEY ("platform_id","family_id") REFERENCES "public"."streaming_platforms"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_platform_checks" ADD CONSTRAINT "library_platform_checks_updated_by_member_id_family_id_members_id_family_id_fk" FOREIGN KEY ("updated_by_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_streaming_offers" ADD CONSTRAINT "library_streaming_offers_check_id_family_id_library_platform_checks_id_family_id_fk" FOREIGN KEY ("check_id","family_id") REFERENCES "public"."library_platform_checks"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaming_platform_aliases" ADD CONSTRAINT "streaming_platform_aliases_platform_id_family_id_streaming_platforms_id_family_id_fk" FOREIGN KEY ("platform_id","family_id") REFERENCES "public"."streaming_platforms"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaming_platforms" ADD CONSTRAINT "streaming_platforms_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION availability_offer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p streaming_platforms; reviewed date;
BEGIN
 SELECT sp.*, c.checked_on INTO p.id,p.family_id,p.name,p.modes,p.coverage,p.coverage_sources,p.requires_channel,p.version,p.created_at,p.updated_at,reviewed
 FROM library_platform_checks c JOIN streaming_platforms sp ON sp.id=c.platform_id AND sp.family_id=c.family_id
 WHERE c.id=NEW.check_id AND c.family_id=NEW.family_id FOR SHARE OF sp;
 IF NOT FOUND OR p.coverage<>'verified' OR NOT NEW.mode=ANY(p.modes)
 OR (p.requires_channel AND (NEW.channel IS NULL OR NOT availability_channel_valid(NEW.channel)))
 OR (NEW.direct_verified_on IS NOT NULL AND (NEW.direct_verified_on>reviewed OR NEW.direct_verified_on<DATE '0001-01-01')) THEN
 RAISE EXCEPTION 'Offer lacks verified coverage, mode, channel or date' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER availability_offer_guard BEFORE INSERT OR UPDATE ON library_streaming_offers FOR EACH ROW EXECUTE FUNCTION availability_offer_guard();
--> statement-breakpoint
CREATE FUNCTION availability_platform_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM library_streaming_offers o JOIN library_platform_checks c ON c.id=o.check_id AND c.family_id=o.family_id
 WHERE c.platform_id=NEW.id AND c.family_id=NEW.family_id AND (NEW.coverage<>'verified' OR NOT o.mode=ANY(NEW.modes) OR (NEW.requires_channel AND o.channel IS NULL))) THEN
 RAISE EXCEPTION 'Withdraw incompatible offers before changing coverage or modes' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER availability_platform_guard BEFORE UPDATE ON streaming_platforms FOR EACH ROW EXECUTE FUNCTION availability_platform_guard();
--> statement-breakpoint
CREATE FUNCTION availability_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Availability proposals are immutable' USING ERRCODE='23514'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER availability_proposal_immutable BEFORE UPDATE ON library_availability_proposals FOR EACH ROW EXECUTE FUNCTION availability_proposal_immutable();

--> statement-breakpoint
CREATE FUNCTION availability_check_offer_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM library_streaming_offers o JOIN library_platform_checks c ON c.id=o.check_id AND c.family_id=o.family_id WHERE c.id=NEW.id AND o.direct_verified_on>c.checked_on) THEN RAISE EXCEPTION 'Direct link verification must not follow review date' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER availability_check_offer_dates AFTER UPDATE ON library_platform_checks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION availability_check_offer_dates();

--> statement-breakpoint
DO $seed$ DECLARE family uuid; platform uuid; BEGIN FOR family IN SELECT id FROM families LOOP
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'Netflix',ARRAY['subscription'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Netflix','netflix');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'Disney+',ARRAY['subscription'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Disney+','disney+');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Disney Plus','disney plus');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'Paramount+',ARRAY['subscription'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Paramount+','paramount+');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Paramount Plus','paramount plus');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'HBO Max',ARRAY['subscription'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'HBO Max','hbo max');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Max','max');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'Prime Video',ARRAY['subscription'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Prime Video','prime video');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Amazon Prime Video','amazon prime video');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'MUBI',ARRAY['subscription'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'MUBI','mubi');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'Apple TV+',ARRAY['subscription'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Apple TV+','apple tv+');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Apple TV Plus','apple tv plus');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'Pluto TV',ARRAY['free_with_ads'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Pluto TV','pluto tv');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Pluto','pluto');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'Plex',ARRAY['free_with_ads'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Plex','plex');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'Fawesome',ARRAY['free_with_ads'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Fawesome','fawesome');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Fawesome TV','fawesome tv');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'YouTube oficial',ARRAY['free','free_with_ads'],true) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'YouTube oficial','youtube oficial');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'YouTube','youtube');
INSERT INTO streaming_platforms(family_id,name,modes,requires_channel) VALUES(family,'CINE.AR Play',ARRAY['free'],false) RETURNING id INTO platform;
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'CINE.AR Play','cine.ar play');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Cinear Play','cinear play');
INSERT INTO streaming_platform_aliases(family_id,platform_id,alias,normalized_alias) VALUES(family,platform,'Cine Ar Play','cine ar play');
END LOOP; END $seed$;
