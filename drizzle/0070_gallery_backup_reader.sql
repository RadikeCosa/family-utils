DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'family_utils_backup_reader') THEN
    GRANT SELECT ON public.gallery_drawings,
      public.gallery_collections,
      public.gallery_collection_drawings,
      public.gallery_invitations,
      public.gallery_guest_sessions
      TO family_utils_backup_reader;
  END IF;
END $$;
