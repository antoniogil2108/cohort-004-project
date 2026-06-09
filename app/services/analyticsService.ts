import { eq, and, sql, desc, isNotNull, inArray } from "drizzle-orm";
import { db } from "~/db";
import {
  purchases,
  coupons,
  courses,
  courseReviews,
  modules,
  lessons,
  enrollments,
  lessonProgress,
  videoWatchEvents,
  LessonProgressStatus,
} from "~/db/schema";

// ─── Course-lesson ordering helper ───
// Course lessons flattened into curriculum order (module position, then lesson
// position). Shared by completion and drop-off metrics.

function orderedCourseLessons(courseId: number) {
  return db
    .select({
      id: lessons.id,
      title: lessons.title,
      durationMinutes: lessons.durationMinutes,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position, lessons.position)
    .all();
}

function enroleeCount(courseId: number): number {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))
      .get()?.count ?? 0
  );
}

// How many of the course's lessons each enrolee has completed (unweighted,
// quizzes excluded). One set-based grouped query — never a per-student loop.
// Enrolees with zero completed lessons are absent from the result.
function completedLessonCountsByEnrolee(
  courseId: number,
  lessonIds: number[]
): number[] {
  if (lessonIds.length === 0) return [];

  return db
    .select({
      completed: sql<number>`count(distinct ${lessonProgress.lessonId})`,
    })
    .from(lessonProgress)
    .innerJoin(enrollments, eq(enrollments.userId, lessonProgress.userId))
    .where(
      and(
        eq(enrollments.courseId, courseId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .groupBy(lessonProgress.userId)
    .all()
    .map((row) => row.completed);
}

// ─── Month bucketing helpers ───
// Trends cover the last 12 UTC months, or from the course's first month when
// the course is younger. Buckets are zero-filled so empty months still render.

function trendMonths(courseId: number): string[] {
  const now = new Date();
  const twelveMonthsAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)
  );

  const course = db
    .select({ createdAt: courses.createdAt })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const courseStart = course
    ? new Date(course.createdAt)
    : twelveMonthsAgo;
  const courseStartMonth = new Date(
    Date.UTC(courseStart.getUTCFullYear(), courseStart.getUTCMonth(), 1)
  );

  const start =
    courseStartMonth > twelveMonthsAgo ? courseStartMonth : twelveMonthsAgo;

  const months: string[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const endYear = now.getUTCFullYear();
  const endMonth = now.getUTCMonth();
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month + 1).padStart(2, "0")}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

function zeroFill(
  months: string[],
  rows: { month: string; value: number }[]
): { month: string; value: number }[] {
  const byMonth = new Map(rows.map((r) => [r.month, r.value]));
  return months.map((month) => ({ month, value: byMonth.get(month) ?? 0 }));
}

// ─── Analytics Service ───
// Per-course instructor analytics. One set-based aggregate function per metric
// (GROUP BY / sum / count in SQLite — no per-student N+1 loops). Each function
// returns plain serialisable data ready for a thin route loader.
// Uses positional parameters (project convention).

// Sales (price > 0) ───────────────────────────────────────────────────────

export function getRevenue(courseId: number): number {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)` })
    .from(purchases)
    .where(eq(purchases.courseId, courseId))
    .get();

  return result?.total ?? 0;
}

export function getSeatsSold(courseId: number): number {
  // Each coupon is one paid seat (a team purchase generates many coupons from a
  // single purchase row); each non-coupon purchase is one individual seat.
  const couponSeats = db
    .select({ count: sql<number>`count(*)` })
    .from(coupons)
    .where(eq(coupons.courseId, courseId))
    .get();

  const individualSeats = db
    .select({ count: sql<number>`count(*)` })
    .from(purchases)
    .where(
      and(
        eq(purchases.courseId, courseId),
        sql`${purchases.id} not in (select ${coupons.purchaseId} from ${coupons})`
      )
    )
    .get();

  return (couponSeats?.count ?? 0) + (individualSeats?.count ?? 0);
}

export function getMonthlyRevenueTrend(
  courseId: number
): { month: string; value: number }[] {
  const rows = db
    .select({
      month: sql<string>`strftime('%Y-%m', ${purchases.createdAt})`,
      value: sql<number>`sum(${purchases.pricePaid})`,
    })
    .from(purchases)
    .where(eq(purchases.courseId, courseId))
    .groupBy(sql`strftime('%Y-%m', ${purchases.createdAt})`)
    .all();

  return zeroFill(trendMonths(courseId), rows);
}

export type RatingDistribution = {
  average: number | null;
  count: number;
  stars: { rating: number; value: number }[];
};

export function getRatingDistribution(courseId: number): RatingDistribution {
  const summary = db
    .select({
      average: sql<number | null>`avg(${courseReviews.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseReviews)
    .where(eq(courseReviews.courseId, courseId))
    .get();

  const count = summary?.count ?? 0;

  const starRows = db
    .select({
      rating: courseReviews.rating,
      value: sql<number>`count(*)`,
    })
    .from(courseReviews)
    .where(eq(courseReviews.courseId, courseId))
    .groupBy(courseReviews.rating)
    .all();
  const byRating = new Map(starRows.map((r) => [r.rating, r.value]));

  return {
    average: count > 0 ? (summary?.average ?? null) : null,
    count,
    stars: [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      value: byRating.get(rating) ?? 0,
    })),
  };
}

export function getTopCountries(
  courseId: number
): { country: string; value: number }[] {
  return db
    .select({
      country: sql<string>`${purchases.country}`,
      value: sql<number>`count(*)`,
    })
    .from(purchases)
    .where(
      and(eq(purchases.courseId, courseId), isNotNull(purchases.country))
    )
    .groupBy(purchases.country)
    .orderBy(desc(sql`count(*)`), purchases.country)
    .all();
}

// Completion (set-based; never loops calculateProgress) ─────────────────────

export function getCompletionRate(courseId: number): number {
  const lessonIds = orderedCourseLessons(courseId).map((l) => l.id);
  const totalLessons = lessonIds.length;
  const totalEnrolees = enroleeCount(courseId);

  if (totalEnrolees === 0 || totalLessons === 0) return 0;

  // "Completed the course" = completed every lesson (unweighted, quizzes excluded).
  const finishers = completedLessonCountsByEnrolee(courseId, lessonIds).filter(
    (completed) => completed >= totalLessons
  ).length;

  return Math.round((finishers / totalEnrolees) * 100);
}

export function getAverageProgress(courseId: number): number {
  const lessonIds = orderedCourseLessons(courseId).map((l) => l.id);
  const totalLessons = lessonIds.length;
  const totalEnrolees = enroleeCount(courseId);

  if (totalEnrolees === 0 || totalLessons === 0) return 0;

  // Enrolees with no completed lessons contribute 0; they're absent from the
  // counts, so we divide the total completed by (lessons × all enrolees).
  const totalCompleted = completedLessonCountsByEnrolee(
    courseId,
    lessonIds
  ).reduce((sum, completed) => sum + completed, 0);

  return Math.round((totalCompleted / (totalLessons * totalEnrolees)) * 100);
}

const PROGRESS_BUCKETS = [
  "0%",
  "1-25%",
  "26-50%",
  "51-75%",
  "76-99%",
  "100%",
] as const;

function progressBucket(pct: number): (typeof PROGRESS_BUCKETS)[number] {
  if (pct <= 0) return "0%";
  if (pct <= 25) return "1-25%";
  if (pct <= 50) return "26-50%";
  if (pct <= 75) return "51-75%";
  if (pct < 100) return "76-99%";
  return "100%";
}

export function getProgressDistribution(
  courseId: number
): { bucket: string; value: number }[] {
  const lessonIds = orderedCourseLessons(courseId).map((l) => l.id);
  const totalLessons = lessonIds.length;

  const counts = new Map<string, number>(
    PROGRESS_BUCKETS.map((b) => [b, 0])
  );

  const totalEnrolees = enroleeCount(courseId);

  if (totalEnrolees > 0 && totalLessons > 0) {
    const perEnrolee = completedLessonCountsByEnrolee(courseId, lessonIds);

    for (const completed of perEnrolee) {
      const pct = Math.round((completed / totalLessons) * 100);
      const bucket = progressBucket(pct);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }

    // Enrolees with no completed lessons are absent above → they're at 0%.
    const zeroEnrolees = totalEnrolees - perEnrolee.length;
    counts.set("0%", (counts.get("0%") ?? 0) + zeroEnrolees);
  }

  return PROGRESS_BUCKETS.map((bucket) => ({
    bucket,
    value: counts.get(bucket) ?? 0,
  }));
}

// Drop-off funnel (deep module) ─────────────────────────────────────────────

export type DropOffLesson = {
  lessonId: number;
  title: string;
  reachPct: number;
  avgPctWatched: number;
  watchedApproximate: boolean;
  isDropOffPoint: boolean;
};

export function getDropOffFunnel(courseId: number): DropOffLesson[] {
  const lessonsOrdered = orderedCourseLessons(courseId);
  if (lessonsOrdered.length === 0) return [];

  const lessonIds = lessonsOrdered.map((l) => l.id);
  const totalEnrolees = enroleeCount(courseId);

  // Reach: distinct enrolled users who have any progress row (= opened) per lesson.
  const reachRows = db
    .select({
      lessonId: lessonProgress.lessonId,
      openers: sql<number>`count(distinct ${lessonProgress.userId})`,
    })
    .from(lessonProgress)
    .innerJoin(enrollments, eq(enrollments.userId, lessonProgress.userId))
    .where(
      and(
        eq(enrollments.courseId, courseId),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .groupBy(lessonProgress.lessonId)
    .all();
  const openersByLesson = new Map(reachRows.map((r) => [r.lessonId, r.openers]));

  // Furthest watched position per viewer per lesson. Scoped to enrolees so
  // instructor/admin/unenrolled previews don't skew the avg-%-watched figure,
  // matching the enrolee-scoped reach metric above.
  const furthestRows = db
    .select({
      lessonId: videoWatchEvents.lessonId,
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .innerJoin(enrollments, eq(enrollments.userId, videoWatchEvents.userId))
    .where(
      and(
        eq(enrollments.courseId, courseId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId, videoWatchEvents.userId)
    .all();
  const furthestByLesson = new Map<number, number[]>();
  for (const row of furthestRows) {
    const list = furthestByLesson.get(row.lessonId) ?? [];
    list.push(row.furthest);
    furthestByLesson.set(row.lessonId, list);
  }

  const rows: DropOffLesson[] = lessonsOrdered.map((lesson) => {
    const openers = openersByLesson.get(lesson.id) ?? 0;
    const reachPct =
      totalEnrolees > 0 ? Math.round((openers / totalEnrolees) * 100) : 0;

    const furthests = furthestByLesson.get(lesson.id) ?? [];
    const durationKnown = lesson.durationMinutes != null;
    const watchedApproximate = !durationKnown;
    const denominator = durationKnown
      ? lesson.durationMinutes! * 60
      : Math.max(0, ...furthests);

    let avgPctWatched = 0;
    if (furthests.length > 0 && denominator > 0) {
      const sumPct = furthests.reduce(
        (sum, pos) => sum + Math.min(Math.round((pos / denominator) * 100), 100),
        0
      );
      avgPctWatched = Math.round(sumPct / furthests.length);
    }

    return {
      lessonId: lesson.id,
      title: lesson.title,
      reachPct,
      avgPctWatched,
      watchedApproximate,
      isDropOffPoint: false,
    };
  });

  // Highlight the lesson at the largest consecutive reach drop.
  let dropIndex = -1;
  let biggestDrop = 0;
  for (let i = 1; i < rows.length; i++) {
    const drop = rows[i - 1].reachPct - rows[i].reachPct;
    if (drop > biggestDrop) {
      biggestDrop = drop;
      dropIndex = i;
    }
  }
  if (dropIndex >= 0) rows[dropIndex].isDropOffPoint = true;

  return rows;
}

// Enrolment trend ───────────────────────────────────────────────────────────

export function getMonthlyEnrollmentTrend(
  courseId: number
): { month: string; value: number }[] {
  const rows = db
    .select({
      month: sql<string>`strftime('%Y-%m', ${enrollments.enrolledAt})`,
      value: sql<number>`count(*)`,
    })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .groupBy(sql`strftime('%Y-%m', ${enrollments.enrolledAt})`)
    .all();

  return zeroFill(trendMonths(courseId), rows);
}
