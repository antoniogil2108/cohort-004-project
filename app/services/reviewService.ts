import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { courseReviews } from "~/db/schema";

// ─── Review Service ───
// Handles course star ratings (1–5, no written text). One rating per user per
// course, editable via upsert. Uses positional parameters (project convention).

export type RatingStats = { average: number | null; count: number };

export function getUserReview(userId: number, courseId: number) {
  return db
    .select()
    .from(courseReviews)
    .where(
      and(
        eq(courseReviews.userId, userId),
        eq(courseReviews.courseId, courseId)
      )
    )
    .get();
}

export function upsertReview(userId: number, courseId: number, rating: number) {
  return db
    .insert(courseReviews)
    .values({ userId, courseId, rating })
    .onConflictDoUpdate({
      target: [courseReviews.userId, courseReviews.courseId],
      set: { rating, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}

export function getCourseRatingStats(courseId: number): RatingStats {
  const result = db
    .select({
      average: sql<number | null>`avg(${courseReviews.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseReviews)
    .where(eq(courseReviews.courseId, courseId))
    .get();

  const count = result?.count ?? 0;
  return {
    average: count > 0 ? (result?.average ?? null) : null,
    count,
  };
}

export function getRatingStatsForCourses(
  courseIds: number[]
): Map<number, RatingStats> {
  const stats = new Map<number, RatingStats>();

  if (courseIds.length === 0) return stats;

  const rows = db
    .select({
      courseId: courseReviews.courseId,
      average: sql<number>`avg(${courseReviews.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseReviews)
    .where(inArray(courseReviews.courseId, courseIds))
    .groupBy(courseReviews.courseId)
    .all();

  for (const row of rows) {
    stats.set(row.courseId, { average: row.average, count: row.count });
  }

  return stats;
}
