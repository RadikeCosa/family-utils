CREATE TABLE "sports_champions_switches" (
	"family_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by_member_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sports_champions_switches" ADD CONSTRAINT "sports_champions_switches_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sports_champions_switches" ADD CONSTRAINT "sports_champions_switches_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
LOCK TABLE public.families IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO public.sports_champions_switches(family_id,enabled) SELECT id,false FROM public.families ON CONFLICT(family_id) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION public.sports_champions_family_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.sports_champions_switches(family_id,enabled) VALUES(NEW.id,false) ON CONFLICT(family_id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sports_champions_switch_default AFTER INSERT ON public.families
FOR EACH ROW EXECUTE FUNCTION public.sports_champions_family_created();
--> statement-breakpoint
--> statement-breakpoint
REVOKE ALL ON public.sports_champions_switches FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.sports_champions_enabled(p_family uuid, p_lock boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_enabled boolean;
BEGIN
  IF p_lock THEN
    SELECT enabled INTO v_enabled FROM public.sports_champions_switches WHERE family_id=p_family FOR SHARE;
  ELSE
    SELECT enabled INTO v_enabled FROM public.sports_champions_switches WHERE family_id=p_family;
  END IF;
  RETURN COALESCE(v_enabled,false);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.sports_champions_set_enabled(p_token text, p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor record; v_role text;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'Ingresá a tu familia.' USING ERRCODE='42501'; END IF;
  SELECT role INTO v_role FROM public.members WHERE id=v_actor.member_id AND family_id=v_actor.family_id AND archived_at IS NULL FOR SHARE;
  IF v_role IS DISTINCT FROM 'administrator' THEN RAISE EXCEPTION 'Solo administración puede cambiar el interruptor.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.sports_champions_switches WHERE family_id=v_actor.family_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontramos el interruptor de esta familia.' USING ERRCODE='P0002'; END IF;
  UPDATE public.sports_champions_switches SET enabled=p_enabled,updated_by_member_id=v_actor.member_id,updated_at=clock_timestamp() WHERE family_id=v_actor.family_id;
  INSERT INTO public.audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after")
  VALUES(v_actor.family_id,v_actor.member_id,'sports_champions_switch',v_actor.family_id,CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,jsonb_build_object('enabled',p_enabled));
  RETURN p_enabled;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.sports_football_predictions_api(p_token text, p_event uuid, p_action text DEFAULT 'read', p_choice text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor record; v_event public.sports_events; v_closed timestamptz;
  v_before text; v_changed boolean := false;
BEGIN
  SELECT * INTO v_actor FROM public.sports_football_session_actor(p_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'data',jsonb_build_object('error','Ingresá a tu familia.')); END IF;
  IF NOT public.sports_champions_enabled(v_actor.family_id,true) THEN
    RETURN jsonb_build_object('status',404,'data',jsonb_build_object('error','No encontrado.'));
  END IF;
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
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  RETURN jsonb_build_object('status',200,'data',public.sports_football_choice_view(v_event,p_token));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_champions_enabled(uuid,boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_champions_set_enabled(text,boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_champions_family_created() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.sports_champions_enabled(uuid,boolean) FROM anon;
    REVOKE ALL ON FUNCTION public.sports_champions_set_enabled(text,boolean) FROM anon;
    REVOKE ALL ON FUNCTION public.sports_champions_family_created() FROM anon;
    REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM anon;
    REVOKE ALL ON public.sports_champions_switches FROM anon;
  END IF;
END $$;
