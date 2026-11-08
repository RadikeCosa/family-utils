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

// The caller supplies only collection/search/genre predicates, never view/status/cursor.
export function commonPendingCountsSql(collectionWhere: string) {
  return `SELECT other.member_id AS "memberId", count(*)::integer AS count
    FROM library_works w
    JOIN library_personal mine ON mine.work_id=w.id AND mine.family_id=w.family_id
      AND mine.member_id=$2 AND mine.status='pending'
    JOIN library_personal other ON other.work_id=w.id AND other.family_id=w.family_id
      AND other.member_id<>$2 AND other.status='pending'
    JOIN members m ON m.id=other.member_id AND m.family_id=w.family_id AND m.archived_at IS NULL
    WHERE ${collectionWhere}
    GROUP BY other.member_id`;
}
