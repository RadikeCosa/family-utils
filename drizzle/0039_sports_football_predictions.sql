CREATE TABLE "sports_football_closures" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"closed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports_football_predictions" (
	"event_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"choice" varchar(4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_football_predictions_choice" CHECK ("sports_football_predictions"."choice" IN ('home','draw','away'))
);
--> statement-breakpoint
ALTER TABLE "sports_events" DROP CONSTRAINT "sports_events_status";--> statement-breakpoint
ALTER TABLE "sports_football_closures" ADD CONSTRAINT "sports_football_closures_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_closures" ADD CONSTRAINT "sports_football_closures_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_predictions" ADD CONSTRAINT "sports_football_predictions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_predictions" ADD CONSTRAINT "sports_football_predictions_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."sports_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_football_predictions" ADD CONSTRAINT "sports_football_predictions_member_fk" FOREIGN KEY ("member_id","family_id") REFERENCES "public"."members"("id","family_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sports_football_predictions_member_event_unique" ON "sports_football_predictions" USING btree ("event_id","member_id");--> statement-breakpoint
ALTER TABLE "sports_events" ADD CONSTRAINT "sports_events_status" CHECK ("sports_events"."status" IN ('scheduled', 'postponed', 'completed', 'cancelled') OR ("sports_events"."football_category" IS NOT DISTINCT FROM 'champions' AND "sports_events"."status" = 'suspended'));--> statement-breakpoint
-- The only time comparison used by reads and final writes. Equality is closed.
-- p_now is internal; the public session API never accepts a caller-supplied clock.
CREATE FUNCTION public.sports_football_choice_open(p_start timestamptz, p_closed timestamptz, p_status text, p_now timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT p_start IS NOT NULL AND p_closed IS NULL AND p_status = 'scheduled' AND p_now < p_start;
$$;
--> statement-breakpoint
CREATE FUNCTION public.sports_football_materialize_close(p_family uuid, p_event uuid, p_start timestamptz, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_now timestamptz := clock_timestamp();
BEGIN
  IF (p_start IS NOT NULL AND p_start <= v_now) OR p_status IN ('suspended','completed','cancelled') THEN
    INSERT INTO public.sports_football_closures(family_id,event_id,closed_at)
    VALUES(p_family,p_event,CASE WHEN p_start IS NOT NULL THEN LEAST(p_start,v_now) ELSE v_now END)
    ON CONFLICT(event_id) DO NOTHING;
  END IF;
END;
$$;
--> statement-breakpoint
-- Every schedule/status update closes against OLD before it can replace the deadline.
-- This also works without any reads between kickoff and a later postponement.
CREATE FUNCTION public.sports_football_preserve_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.kind = 'football_match' AND OLD.football_category = 'champions' THEN
    PERFORM public.sports_football_materialize_close(OLD.family_id,OLD.id,OLD.starts_at,OLD.status);
    IF ROW(NEW.id,NEW.family_id,NEW.kind,NEW.football_category,NEW.season_id,NEW.round_id,NEW.first_team_id,NEW.second_team_id)
       IS DISTINCT FROM ROW(OLD.id,OLD.family_id,OLD.kind,OLD.football_category,OLD.season_id,OLD.round_id,OLD.first_team_id,OLD.second_team_id)
       AND (EXISTS(SELECT 1 FROM public.sports_football_predictions WHERE event_id=OLD.id)
            OR EXISTS(SELECT 1 FROM public.sports_football_closures WHERE event_id=OLD.id)) THEN
      RAISE EXCEPTION 'No se puede cambiar la identidad de un partido con elecciones o cierre.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.kind = 'football_match' AND NEW.football_category = 'champions' THEN
    PERFORM public.sports_football_materialize_close(NEW.family_id,NEW.id,NEW.starts_at,NEW.status);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sports_events_preserve_football_close BEFORE UPDATE ON public.sports_events
FOR EACH ROW EXECUTE FUNCTION public.sports_football_preserve_close();
--> statement-breakpoint
-- Resolve identity from an unexpired real Better Auth session, not caller-provided IDs.
CREATE FUNCTION public.sports_football_session_actor(p_token text)
RETURNS TABLE(family_id uuid, member_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY SELECT m.family_id,m.id FROM public.session s
    JOIN public.member_devices d ON d.auth_user_id=s.user_id
    JOIN public.members m ON m.id=d.member_id
    WHERE s.token=p_token AND s.expires_at>clock_timestamp()
      AND d.revoked_at IS NULL AND m.archived_at IS NULL
    FOR SHARE OF s,d,m;
END;
$$;
--> statement-breakpoint
-- The database builds the response. Before closure, it never reads other choices
-- into the response and never returns counts of other members' participation.
CREATE FUNCTION public.sports_football_choice_view(p_event public.sports_events, p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_closed timestamptz; v_own text; v_choices jsonb := '[]'::jsonb;
BEGIN
  SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event.id;
  SELECT choice INTO v_own FROM public.sports_football_predictions WHERE event_id=p_event.id AND member_id=p_member;
  IF v_closed IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId',p.member_id,'name',m.name,'choice',p.choice) ORDER BY p.member_id),'[]'::jsonb)
      INTO v_choices FROM public.sports_football_predictions p JOIN public.members m ON m.id=p.member_id AND m.family_id=p.family_id
      WHERE p.event_id=p_event.id AND p.family_id=p_event.family_id;
  END IF;
  RETURN jsonb_build_object('eventId',p_event.id,'closesAt',COALESCE(v_closed,p_event.starts_at),
    'closed',v_closed IS NOT NULL,
    'canPredict',public.sports_football_choice_open(p_event.starts_at,v_closed,p_event.status,clock_timestamp())
      AND p_event.first_team_id IS NOT NULL AND p_event.second_team_id IS NOT NULL
      AND length(btrim(p_event.first_participant))>0 AND length(btrim(p_event.second_participant))>0,
    'ownChoice',v_own,'choices',v_choices);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.sports_football_predictions_api(p_token text, p_event uuid, p_action text DEFAULT 'read', p_choice text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor record; v_event public.sports_events; v_closed timestamptz;
  v_before text; v_changed boolean := false;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  SELECT * INTO v_event FROM public.sports_events WHERE id=p_event AND family_id=v_actor.family_id
    AND kind='football_match' AND football_category='champions' AND hidden=false AND source_absent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontramos este partido.')); END IF;
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  IF p_action IS NULL OR p_action NOT IN ('read','put','delete') OR (p_action='put' AND (p_choice IS NULL OR p_choice NOT IN ('home','draw','away'))) THEN
    RETURN jsonb_build_object('status',400,'data',jsonb_build_object('error','Pronóstico inválido.'));
  END IF;
  IF p_action <> 'read' THEN
    SELECT closed_at INTO v_closed FROM public.sports_football_closures WHERE event_id=p_event;
    IF NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      OR v_event.first_team_id IS NULL OR v_event.second_team_id IS NULL
      OR length(btrim(v_event.first_participant))=0 OR length(btrim(v_event.second_participant))=0 THEN
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    SELECT choice INTO v_before FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id;
    IF p_action='put' THEN
      INSERT INTO public.sports_football_predictions(family_id,event_id,member_id,choice)
      SELECT v_actor.family_id,p_event,v_actor.member_id,p_choice
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      ON CONFLICT(event_id,member_id) DO UPDATE SET choice=excluded.choice,updated_at=clock_timestamp()
      WHERE public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    ELSE
      DELETE FROM public.sports_football_predictions WHERE event_id=p_event AND member_id=v_actor.member_id
        AND public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())
      RETURNING true INTO v_changed;
    END IF;
    IF NOT COALESCE(v_changed,false) AND (p_action='put' OR v_before IS NOT NULL OR NOT public.sports_football_choice_open(v_event.starts_at,v_closed,v_event.status,clock_timestamp())) THEN
      PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
      RETURN jsonb_build_object('status',409,'data',jsonb_build_object('error','El partido no admite cambios de pronóstico.'));
    END IF;
    IF (p_action='put' AND v_before IS DISTINCT FROM p_choice) OR (p_action='delete' AND v_before IS NOT NULL) THEN
      INSERT INTO public.audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after")
      VALUES(v_actor.family_id,v_actor.member_id,'sports_football_prediction',p_event,
        CASE WHEN p_action='delete' THEN 'deleted' WHEN v_before IS NULL THEN 'saved' ELSE 'changed' END,
        jsonb_build_object('eventId',p_event));
    END IF;
  END IF;
  -- A read or a successful mutation may have crossed kickoff; persist before disclosure.
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  RETURN jsonb_build_object('status',200,'data',public.sports_football_choice_view(v_event,v_actor.member_id));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON public.sports_football_predictions, public.sports_football_closures FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_choice_open(timestamptz,timestamptz,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_materialize_close(uuid,uuid,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_preserve_close() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_session_actor(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_choice_view(public.sports_events,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) TO PUBLIC;
