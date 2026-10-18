CREATE OR REPLACE FUNCTION public.sports_football_predictions_api(p_token text, p_event uuid, p_action text DEFAULT 'read', p_choice text DEFAULT NULL)
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
  PERFORM public.sports_football_materialize_close(v_event.family_id,v_event.id,v_event.starts_at,v_event.status);
  RETURN jsonb_build_object('status',200,'data',public.sports_football_choice_view(v_event,p_token));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.sports_football_predictions_api(text,uuid,text,text) FROM anon;
  END IF;
END $$;
