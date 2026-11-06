-- Run inside the transaction of a NEW compensating migration, never automatically.
SET LOCAL lock_timeout = '2s';
LOCK TABLE library_works IN ACCESS EXCLUSIVE MODE;
ALTER TABLE library_works DROP CONSTRAINT library_works_kind;
ALTER TABLE library_works ADD CONSTRAINT library_works_kind CHECK (kind IN ('movie', 'series', 'book', 'music', 'art', 'video_game', 'tabletop_game'));
