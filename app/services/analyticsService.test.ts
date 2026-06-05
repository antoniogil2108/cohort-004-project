import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after the mock so the service picks up our test db.
import {
  getRevenue,
  getSeatsSold,
  getMonthlyRevenueTrend,
  getTopCountries,
  getCompletionRate,
  getAverageProgress,
  getProgressDistribution,
  getDropOffFunnel,
  getMonthlyEnrollmentTrend,
  getRatingDistribution,
} from "./analyticsService";

// ─── Local seed helpers (composed per test so expected values stay obvious) ───

let studentSeq = 0;
function addStudent() {
  studentSeq += 1;
  return testDb
    .insert(schema.users)
    .values({
      name: `Student ${studentSeq}`,
      email: `student${studentSeq}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function addPurchase(
  userId: number,
  courseId: number,
  pricePaid: number,
  country: string | null = "US",
  createdAt?: string
) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId,
      courseId,
      pricePaid,
      country,
      ...(createdAt ? { createdAt } : {}),
    })
    .returning()
    .get();
}

function addModule(courseId: number, position: number) {
  return testDb
    .insert(schema.modules)
    .values({ courseId, title: `Module ${position}`, position })
    .returning()
    .get();
}

function addLesson(
  moduleId: number,
  position: number,
  durationMinutes: number | null = null
) {
  return testDb
    .insert(schema.lessons)
    .values({ moduleId, title: `Lesson ${position}`, position, durationMinutes })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number, enrolledAt?: string) {
  return testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, ...(enrolledAt ? { enrolledAt } : {}) })
    .returning()
    .get();
}

function addProgress(
  userId: number,
  lessonId: number,
  status: schema.LessonProgressStatus
) {
  return testDb
    .insert(schema.lessonProgress)
    .values({ userId, lessonId, status })
    .returning()
    .get();
}

function addWatch(userId: number, lessonId: number, positionSeconds: number) {
  return testDb
    .insert(schema.videoWatchEvents)
    .values({ userId, lessonId, eventType: "progress", positionSeconds })
    .returning()
    .get();
}

let couponSeq = 0;
function addTeamPurchase(
  buyerId: number,
  courseId: number,
  seats: number,
  pricePaid = 10000
) {
  const team = testDb.insert(schema.teams).values({}).returning().get();
  const purchase = addPurchase(buyerId, courseId, pricePaid);
  const coupons = Array.from({ length: seats }, () => {
    couponSeq += 1;
    return testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId,
        code: `CODE-${couponSeq}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get();
  });
  return { team, purchase, coupons };
}

function setCourseCreatedAt(courseId: number, iso: string) {
  testDb
    .update(schema.courses)
    .set({ createdAt: iso })
    .where(eq(schema.courses.id, courseId))
    .run();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    studentSeq = 0;
  });

  // ─── Revenue ───

  describe("getRevenue", () => {
    it("sums pricePaid across the course's purchases", () => {
      const a = addStudent();
      const b = addStudent();
      addPurchase(a.id, base.course.id, 4999);
      addPurchase(b.id, base.course.id, 2500);

      expect(getRevenue(base.course.id)).toBe(7499);
    });

    it("returns 0 when the course has no purchases", () => {
      expect(getRevenue(base.course.id)).toBe(0);
    });
  });

  // ─── Seats sold ───

  describe("getSeatsSold", () => {
    it("counts individual purchases plus all team coupons, not purchase rows", () => {
      const individual = addStudent();
      addPurchase(individual.id, base.course.id, 4999);

      const teamBuyer = addStudent();
      addTeamPurchase(teamBuyer.id, base.course.id, 5);

      // 1 individual seat + 5 coupon seats (from a single team purchase row)
      expect(getSeatsSold(base.course.id)).toBe(6);
    });

    it("returns 0 when the course has no purchases", () => {
      expect(getSeatsSold(base.course.id)).toBe(0);
    });
  });

  // ─── Monthly revenue trend ───

  describe("getMonthlyRevenueTrend", () => {
    beforeEach(() => {
      vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("buckets revenue by UTC month across the last 12 months, zero-filling gaps", () => {
      setCourseCreatedAt(base.course.id, "2024-01-01T00:00:00.000Z");
      const a = addStudent();
      const b = addStudent();
      addPurchase(a.id, base.course.id, 5000, "US", "2026-06-10T00:00:00.000Z");
      addPurchase(b.id, base.course.id, 3000, "US", "2026-04-20T00:00:00.000Z");

      const trend = getMonthlyRevenueTrend(base.course.id);

      expect(trend).toHaveLength(12);
      expect(trend[0].month).toBe("2025-07");
      expect(trend[11].month).toBe("2026-06");
      expect(trend.find((t) => t.month === "2026-06")!.value).toBe(5000);
      expect(trend.find((t) => t.month === "2026-04")!.value).toBe(3000);
      expect(trend.find((t) => t.month === "2025-12")!.value).toBe(0);
    });

    it("starts from the course's first month when the course is younger than 12 months", () => {
      setCourseCreatedAt(base.course.id, "2026-04-05T00:00:00.000Z");

      const trend = getMonthlyRevenueTrend(base.course.id);

      expect(trend.map((t) => t.month)).toEqual([
        "2026-04",
        "2026-05",
        "2026-06",
      ]);
      expect(trend.every((t) => t.value === 0)).toBe(true);
    });
  });

  // ─── Top countries ───

  describe("getTopCountries", () => {
    it("counts purchases per country, descending, excluding unknown country", () => {
      const a = addStudent();
      const b = addStudent();
      const c = addStudent();
      const d = addStudent();
      addPurchase(a.id, base.course.id, 4999, "US");
      addPurchase(b.id, base.course.id, 4999, "US");
      addPurchase(c.id, base.course.id, 4999, "GB");
      addPurchase(d.id, base.course.id, 4999, null);

      const countries = getTopCountries(base.course.id);

      expect(countries).toEqual([
        { country: "US", value: 2 },
        { country: "GB", value: 1 },
      ]);
    });

    it("returns an empty array when the course has no purchases", () => {
      expect(getTopCountries(base.course.id)).toEqual([]);
    });
  });

  // ─── Completion rate ───

  describe("getCompletionRate", () => {
    it("is the share of all enrolees who completed every lesson, counting no-shows against it", () => {
      const mod = addModule(base.course.id, 1);
      const l1 = addLesson(mod.id, 1);
      const l2 = addLesson(mod.id, 2);

      const finisher = addStudent();
      const partial = addStudent();
      const noShow = addStudent();
      enroll(finisher.id, base.course.id);
      enroll(partial.id, base.course.id);
      enroll(noShow.id, base.course.id);

      // finisher completes both lessons → completed the course
      addProgress(finisher.id, l1.id, schema.LessonProgressStatus.Completed);
      addProgress(finisher.id, l2.id, schema.LessonProgressStatus.Completed);
      // partial completes one, opens the other
      addProgress(partial.id, l1.id, schema.LessonProgressStatus.Completed);
      addProgress(partial.id, l2.id, schema.LessonProgressStatus.InProgress);
      // noShow has no progress at all

      // 1 of 3 enrolees finished
      expect(getCompletionRate(base.course.id)).toBe(33);
    });

    it("returns 0 when the course has no enrolees", () => {
      const mod = addModule(base.course.id, 1);
      addLesson(mod.id, 1);
      expect(getCompletionRate(base.course.id)).toBe(0);
    });
  });

  // ─── Average progress ───

  describe("getAverageProgress", () => {
    it("averages each enrolee's completion percentage, including no-shows at 0", () => {
      const mod = addModule(base.course.id, 1);
      const l1 = addLesson(mod.id, 1);
      const l2 = addLesson(mod.id, 2);

      const finisher = addStudent();
      const partial = addStudent();
      const noShow = addStudent();
      enroll(finisher.id, base.course.id);
      enroll(partial.id, base.course.id);
      enroll(noShow.id, base.course.id);

      addProgress(finisher.id, l1.id, schema.LessonProgressStatus.Completed);
      addProgress(finisher.id, l2.id, schema.LessonProgressStatus.Completed);
      addProgress(partial.id, l1.id, schema.LessonProgressStatus.Completed);

      // (100 + 50 + 0) / 3
      expect(getAverageProgress(base.course.id)).toBe(50);
    });

    it("returns 0 when the course has no enrolees", () => {
      const mod = addModule(base.course.id, 1);
      addLesson(mod.id, 1);
      expect(getAverageProgress(base.course.id)).toBe(0);
    });
  });

  // ─── Progress distribution ───

  describe("getProgressDistribution", () => {
    it("buckets enrolees by completion percentage, with no-shows in the 0% bucket", () => {
      const mod = addModule(base.course.id, 1);
      const l1 = addLesson(mod.id, 1);
      const l2 = addLesson(mod.id, 2);
      const l3 = addLesson(mod.id, 3);
      const l4 = addLesson(mod.id, 4);

      const noShow = addStudent();
      const quarter = addStudent();
      const half = addStudent();
      const finisher = addStudent();
      [noShow, quarter, half, finisher].forEach((s) =>
        enroll(s.id, base.course.id)
      );

      addProgress(quarter.id, l1.id, schema.LessonProgressStatus.Completed); // 25%
      addProgress(half.id, l1.id, schema.LessonProgressStatus.Completed);
      addProgress(half.id, l2.id, schema.LessonProgressStatus.Completed); // 50%
      [l1, l2, l3, l4].forEach((l) =>
        addProgress(finisher.id, l.id, schema.LessonProgressStatus.Completed)
      ); // 100%

      expect(getProgressDistribution(base.course.id)).toEqual([
        { bucket: "0%", value: 1 },
        { bucket: "1-25%", value: 1 },
        { bucket: "26-50%", value: 1 },
        { bucket: "51-75%", value: 0 },
        { bucket: "76-99%", value: 0 },
        { bucket: "100%", value: 1 },
      ]);
    });

    it("returns all-zero buckets when the course has no enrolees", () => {
      const mod = addModule(base.course.id, 1);
      addLesson(mod.id, 1);

      expect(getProgressDistribution(base.course.id)).toEqual([
        { bucket: "0%", value: 0 },
        { bucket: "1-25%", value: 0 },
        { bucket: "26-50%", value: 0 },
        { bucket: "51-75%", value: 0 },
        { bucket: "76-99%", value: 0 },
        { bucket: "100%", value: 0 },
      ]);
    });
  });

  // ─── Drop-off funnel ───

  describe("getDropOffFunnel", () => {
    it("reports reach, avg % watched and the largest-drop point per lesson in course order", () => {
      const mod = addModule(base.course.id, 1);
      const l1 = addLesson(mod.id, 1, 10); // duration known: 600s
      const l2 = addLesson(mod.id, 2, 10);
      const l3 = addLesson(mod.id, 3, null); // duration unknown

      const a = addStudent();
      const b = addStudent();
      const c = addStudent();
      const d = addStudent();
      [a, b, c, d].forEach((s) => enroll(s.id, base.course.id));

      // Opens (any lesson-progress row = opened): l1 all, l2 a+b, l3 a+b
      [a, b, c, d].forEach((s) =>
        addProgress(s.id, l1.id, schema.LessonProgressStatus.InProgress)
      );
      [a, b].forEach((s) =>
        addProgress(s.id, l2.id, schema.LessonProgressStatus.InProgress)
      );
      [a, b].forEach((s) =>
        addProgress(s.id, l3.id, schema.LessonProgressStatus.InProgress)
      );

      // Watch events (furthest position per viewer)
      addWatch(a.id, l1.id, 600); // 100% of 600s
      addWatch(b.id, l1.id, 300); // 50%
      addWatch(a.id, l3.id, 120);
      addWatch(b.id, l3.id, 240); // max observed → fallback denominator 240

      const funnel = getDropOffFunnel(base.course.id);

      expect(funnel.map((f) => f.lessonId)).toEqual([l1.id, l2.id, l3.id]);

      expect(funnel[0]).toMatchObject({
        title: "Lesson 1",
        reachPct: 100,
        avgPctWatched: 75, // (100 + 50) / 2
        watchedApproximate: false,
        isDropOffPoint: false,
      });
      expect(funnel[1]).toMatchObject({
        reachPct: 50,
        avgPctWatched: 0, // no watch events
        watchedApproximate: false,
        isDropOffPoint: true, // largest consecutive drop (100 → 50)
      });
      expect(funnel[2]).toMatchObject({
        reachPct: 50,
        avgPctWatched: 75, // (50 + 100) / 2 against fallback denominator 240
        watchedApproximate: true,
        isDropOffPoint: false,
      });
    });

    it("reports 0% reach for a lesson no enrolee has opened", () => {
      const mod = addModule(base.course.id, 1);
      const l1 = addLesson(mod.id, 1, 10);
      const opened = addStudent();
      const other = addStudent();
      enroll(opened.id, base.course.id);
      enroll(other.id, base.course.id);
      addProgress(opened.id, l1.id, schema.LessonProgressStatus.InProgress);

      const funnel = getDropOffFunnel(base.course.id);

      expect(funnel[0].reachPct).toBe(50);
      // a second, never-opened lesson
      const l2 = addLesson(mod.id, 2, 10);
      const refreshed = getDropOffFunnel(base.course.id);
      expect(refreshed.find((f) => f.lessonId === l2.id)!.reachPct).toBe(0);
    });

    it("returns an empty array when the course has no lessons", () => {
      const s = addStudent();
      enroll(s.id, base.course.id);
      expect(getDropOffFunnel(base.course.id)).toEqual([]);
    });
  });

  // ─── Monthly enrolment trend ───

  describe("getMonthlyEnrollmentTrend", () => {
    beforeEach(() => {
      vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts enrolments by UTC month across the last 12 months, zero-filling gaps", () => {
      setCourseCreatedAt(base.course.id, "2024-01-01T00:00:00.000Z");
      const a = addStudent();
      const b = addStudent();
      const c = addStudent();
      enroll(a.id, base.course.id, "2026-06-02T00:00:00.000Z");
      enroll(b.id, base.course.id, "2026-06-20T00:00:00.000Z");
      enroll(c.id, base.course.id, "2026-04-10T00:00:00.000Z");

      const trend = getMonthlyEnrollmentTrend(base.course.id);

      expect(trend).toHaveLength(12);
      expect(trend[11].month).toBe("2026-06");
      expect(trend.find((t) => t.month === "2026-06")!.value).toBe(2);
      expect(trend.find((t) => t.month === "2026-04")!.value).toBe(1);
      expect(trend.find((t) => t.month === "2025-12")!.value).toBe(0);
    });

    it("zero-fills every month when the course has no enrolments", () => {
      setCourseCreatedAt(base.course.id, "2024-01-01T00:00:00.000Z");
      const trend = getMonthlyEnrollmentTrend(base.course.id);
      expect(trend).toHaveLength(12);
      expect(trend.every((t) => t.value === 0)).toBe(true);
    });
  });

  // ─── Rating distribution ───

  function addReview(userId: number, courseId: number, rating: number) {
    return testDb
      .insert(schema.courseReviews)
      .values({ userId, courseId, rating })
      .returning()
      .get();
  }

  describe("getRatingDistribution", () => {
    it("returns the average, count and per-star counts (1–5)", () => {
      const a = addStudent();
      const b = addStudent();
      const c = addStudent();
      const d = addStudent();
      addReview(a.id, base.course.id, 5);
      addReview(b.id, base.course.id, 5);
      addReview(c.id, base.course.id, 4);
      addReview(d.id, base.course.id, 3);

      expect(getRatingDistribution(base.course.id)).toEqual({
        average: 4.25,
        count: 4,
        stars: [
          { rating: 1, value: 0 },
          { rating: 2, value: 0 },
          { rating: 3, value: 1 },
          { rating: 4, value: 1 },
          { rating: 5, value: 2 },
        ],
      });
    });

    it("returns a null average and zeroed stars when there are no reviews", () => {
      expect(getRatingDistribution(base.course.id)).toEqual({
        average: null,
        count: 0,
        stars: [
          { rating: 1, value: 0 },
          { rating: 2, value: 0 },
          { rating: 3, value: 0 },
          { rating: 4, value: 0 },
          { rating: 5, value: 0 },
        ],
      });
    });
  });
});
