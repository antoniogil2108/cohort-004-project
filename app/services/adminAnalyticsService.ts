import { eq, sql, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  purchases,
  courses,
  courseReviews,
  enrollments,
  users,
  CourseStatus,
} from "~/db/schema";

// ─── Admin (platform-wide) Analytics Service ───
// The admin counterpart to the per-course `analyticsService`. Deliberately a
// separate module because the grain differs: this is platform-scoped, not
// `courseId`-scoped. Every figure is all-time and set-based (sum / count /
// avg / a single GROUP BY) — never a per-course loop. Each function returns
// plain serialisable data ready for a thin route loader.
//
// "Instructor" means a course owner (distinct courses.instructorId), used
// identically for the KPI count and the leaderboard rows, so the count equals
// the number of leaderboard rows. Role is never used to define an instructor.
//
// Status handling: revenue, enrollments and the leaderboard count courses of
// ANY status (historical truth — archiving a course must not erase the money
// it earned). Only the "published courses" KPI filters to `published`.

export type PlatformTotals = {
  totalRevenue: number; // sum(purchases.pricePaid), all courses, all statuses
  totalEnrollments: number; // count(enrollments), all statuses
  publishedCourses: number; // count(courses where status = published)
  instructorCount: number; // count(distinct courses.instructorId)
  averageRating: number | null; // review-weighted avg(courseReviews.rating); null when no reviews
};

export function getPlatformTotals(): PlatformTotals {
  const revenue = db
    .select({ total: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)` })
    .from(purchases)
    .get();

  const enrollmentCount = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .get();

  const published = db
    .select({ count: sql<number>`count(*)` })
    .from(courses)
    .where(eq(courses.status, CourseStatus.Published))
    .get();

  const instructors = db
    .select({ count: sql<number>`count(distinct ${courses.instructorId})` })
    .from(courses)
    .get();

  // Review-weighted: avg over every review row (each review counts once), so a
  // one-review course can't outweigh a high-volume one. Null when no reviews.
  const rating = db
    .select({
      average: sql<number | null>`avg(${courseReviews.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseReviews)
    .get();

  return {
    totalRevenue: revenue?.total ?? 0,
    totalEnrollments: enrollmentCount?.count ?? 0,
    publishedCourses: published?.count ?? 0,
    instructorCount: instructors?.count ?? 0,
    averageRating: (rating?.count ?? 0) > 0 ? (rating?.average ?? null) : null,
  };
}

export type InstructorRevenueRow = {
  instructorId: number;
  instructorName: string;
  revenue: number; // sum(pricePaid) over courses they own
};

// One row per distinct course owner. A single GROUP BY courses.instructorId,
// joined to users for the name and LEFT joined to purchases so owners with no
// sales still surface at 0. Team/bundle purchases are a single purchases row at
// the full bundle price, so summing pricePaid attributes them in full to the
// owner. Sorted revenue desc, then name asc.
export function getInstructorRevenueLeaderboard(): InstructorRevenueRow[] {
  return db
    .select({
      instructorId: courses.instructorId,
      instructorName: users.name,
      revenue: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)`,
    })
    .from(courses)
    .innerJoin(users, eq(users.id, courses.instructorId))
    .leftJoin(purchases, eq(purchases.courseId, courses.id))
    .groupBy(courses.instructorId)
    .orderBy(desc(sql`coalesce(sum(${purchases.pricePaid}), 0)`), users.name)
    .all();
}
