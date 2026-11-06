// Evaluate membership before pagination, using the work/member unique index.
export const commonPendingSql = `EXISTS (
  SELECT 1 FROM members m WHERE m.family_id=w.family_id AND m.archived_at IS NULL
) AND NOT EXISTS (
  SELECT 1 FROM members m
  WHERE m.family_id=w.family_id AND m.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM library_personal p
    WHERE p.work_id=w.id AND p.member_id=m.id AND p.status='pending'
  )
)`;
