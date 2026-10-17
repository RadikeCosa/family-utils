CREATE TABLE "sports_football_resolutions" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"reason" varchar(500),
	"source" varchar(1000),
	"actor_member_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_football_resolutions_shape" CHECK (("sports_football_resolutions"."kind" = 'official_result' AND "sports_football_resolutions"."reason" IS NULL AND "sports_football_resolutions"."source" IS NOT NULL) OR ("sports_football_resolutions"."kind" = 'void_for_prode' AND length(btrim("sports_football_resolutions"."reason")) > 0 AND "sports_football_resolutions"."source" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "sports_football_resolutions" ADD CONSTRAINT "sports_football_resolutions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_resolutions" ADD CONSTRAINT "sports_football_resolutions_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_resolutions" ADD CONSTRAINT "sports_football_resolutions_actor_fk" FOREIGN KEY ("actor_member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_football_round_table(p_token text, p_round uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor record; resolved integer; total integer; scores jsonb; standings jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sports_football_rounds r JOIN public.sports_football_seasons s ON s.id=r.season_id AND s.family_id=r.family_id WHERE r.id=p_round AND r.family_id=actor.family_id AND s.competition='champions') THEN
    RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontramos esta jornada.'));
  END IF;
  SELECT count(*) INTO total FROM public.sports_events e
    WHERE e.round_id=p_round AND e.family_id=actor.family_id AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status<>'cancelled'
      AND NOT EXISTS(SELECT 1 FROM public.sports_football_resolutions x WHERE x.event_id=e.id AND x.family_id=e.family_id AND x.kind='void_for_prode');
  SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('eventId',e.id,'homeGoals',r.home_goals,'awayGoals',r.away_goals,'source',r.source,'checkedAt',r.checked_at) ORDER BY e.id),'[]'::jsonb)
    INTO resolved,scores FROM public.sports_events e
    JOIN public.sports_football_results r ON r.event_id=e.id AND r.family_id=e.family_id
    JOIN public.sports_football_closures c ON c.event_id=e.id AND c.family_id=e.family_id
    WHERE e.round_id=p_round AND e.family_id=actor.family_id AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status='completed' AND c.closed_at<=clock_timestamp();
  IF resolved>0 THEN
    WITH points AS (
      SELECT m.id,m.name,COALESCE(sum(CASE WHEN p.choice=CASE WHEN r.home_goals>r.away_goals THEN 'home' WHEN r.home_goals<r.away_goals THEN 'away' ELSE 'draw' END THEN 1 ELSE 0 END),0)::integer AS points
      FROM public.members m
      LEFT JOIN (public.sports_football_predictions p
        JOIN public.sports_events e ON e.id=p.event_id AND e.family_id=p.family_id AND e.round_id=p_round AND e.football_category='champions' AND NOT e.hidden AND e.source_absent_at IS NULL AND e.status='completed'
        JOIN public.sports_football_results r ON r.event_id=e.id AND r.family_id=e.family_id
        JOIN public.sports_football_closures c ON c.event_id=e.id AND c.family_id=e.family_id AND c.closed_at<=clock_timestamp())
        ON p.member_id=m.id AND p.family_id=m.family_id
      WHERE m.family_id=actor.family_id AND m.archived_at IS NULL GROUP BY m.id,m.name
    ), ranked AS (SELECT id,name,points,rank() OVER(ORDER BY points DESC)::integer AS position FROM points)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId',id,'name',name,'points',points,'position',position) ORDER BY position,name,id),'[]'::jsonb) INTO standings FROM ranked;
  END IF;
  RETURN jsonb_build_object('status',200,'data',jsonb_build_object('roundId',p_round,'partial',resolved<total,'resolvedMatches',resolved,'totalMatches',total,'standings',standings,'results',scores));
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_football_round_table(text,uuid) FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION public.sports_football_round_table(text,uuid) FROM anon; END IF; END $$;
