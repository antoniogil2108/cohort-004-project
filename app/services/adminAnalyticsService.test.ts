import { describe, it, expect, beforeEach, vi } from "vitest";
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
  getPlatformTotals,
  getInstructorRevenueLeaderboard,
} from "./adminAnalyticsService";

// ─── Local seed helpers (composed per test so expected values stay obvious) ───

let userSeq = 0;
function addUser(role: schema.UserRole, name?: string) {
  userSeq += 1;
  return testDb
    .insert(schema.users)
    .values({
      name: name ?? `User ${userSeq}`,
      email: `user${userSeq}@example.com`,
      role,
    })
    .returning()
    .get();
}

function addStudent(name?: string) {
  return addUser(schema.UserRole.Student, name);
}

function addInstructor(name?: string) {
  return addUser(schema.UserRole.Instructor, name);
}

let courseSeq = 0;
function addCourse(instructorId: number, status: schema.CourseStatus) {
  courseSeq += 1;
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${courseSeq}`,
      slug: `course-${courseSeq}`,
      description: "A course",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

function addPurchase(userId: number, courseId: number, pricePaid: number) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, pricePaid })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number) {
  return testDb
    .insert(schema.enrollments)
    .values({ userId, courseId })
    .returning()
    .get();
}

function addReview(userId: number, courseId: number, rating: number) {
  return testDb
    .insert(schema.courseReviews)
    .values({ userId, courseId, rating })
    .returning()
    .get();
}

let couponSeq = 0;
function addTeamPurchase(
  buyerId: number,
  courseId: number,
  seats: number,
  pricePaid: number
) {
  const team = testDb.insert(schema.teams).values({}).returning().get();
  const purchase = addPurchase(buyerId, courseId, pricePaid);
  for (let i = 0; i < seats; i++) {
    couponSeq += 1;
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId,
        code: `CODE-${couponSeq}`,
        purchaseId: purchase.id,
      })
      .run();
  }
  return { team, purchase };
}

describe("adminAnalyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    // seedBaseData seeds one Instructor owning one Published course (no
    // purchases / enrollments / reviews), plus a Student and a category.
    base = seedBaseData(testDb);
    userSeq = 0;
    courseSeq = 0;
    couponSeq = 0;
  });

  // ─── Platform totals ───

  describe("getPlatformTotals", () => {
    it("sums revenue across courses of every status", () => {
      const i2 = addInstructor();
      const draft = addCourse(i2.id, schema.CourseStatus.Draft);
      const archived = addCourse(i2.id, schema.CourseStatus.Archived);

      const a = addStudent();
      const b = addStudent();
      const c = addStudent();
      addPurchase(a.id, base.course.id, 5000); // published
      addPurchase(b.id, draft.id, 3000); // draft
      addPurchase(c.id, archived.id, 2000); // archived

      expect(getPlatformTotals().totalRevenue).toBe(10000);
    });

    it("counts enrollments across courses of every status", () => {
      const i2 = addInstructor();
      const draft = addCourse(i2.id, schema.CourseStatus.Draft);
      const archived = addCourse(i2.id, schema.CourseStatus.Archived);

      const a = addStudent();
      const b = addStudent();
      const c = addStudent();
      enroll(a.id, base.course.id); // published
      enroll(b.id, draft.id); // draft
      enroll(c.id, archived.id); // archived

      expect(getPlatformTotals().totalEnrollments).toBe(3);
    });

    it("counts only published courses for publishedCourses, while revenue spans all statuses", () => {
      const i2 = addInstructor();
      const published2 = addCourse(i2.id, schema.CourseStatus.Published);
      const draft = addCourse(i2.id, schema.CourseStatus.Draft);

      const a = addStudent();
      addPurchase(a.id, draft.id, 4000);

      const totals = getPlatformTotals();
      // base.course + published2 are published; the draft is not.
      expect(totals.publishedCourses).toBe(2);
      // but the draft's revenue still counts toward the platform total.
      expect(totals.totalRevenue).toBe(4000);
    });

    it("counts distinct course owners as the instructor count", () => {
      const i2 = addInstructor();
      addCourse(i2.id, schema.CourseStatus.Published);
      addCourse(i2.id, schema.CourseStatus.Draft); // same owner — counted once
      const i3 = addInstructor();
      addCourse(i3.id, schema.CourseStatus.Published);

      // base instructor + i2 + i3 = 3 distinct owners
      expect(getPlatformTotals().instructorCount).toBe(3);
    });

    it("review-weights the average rating so a single-review course can't outweigh a high-volume one", () => {
      const i2 = addInstructor();
      const lowVolume = addCourse(i2.id, schema.CourseStatus.Published);

      // High-volume course on base.course: three 2-star reviews.
      const r1 = addStudent();
      const r2 = addStudent();
      const r3 = addStudent();
      addReview(r1.id, base.course.id, 2);
      addReview(r2.id, base.course.id, 2);
      addReview(r3.id, base.course.id, 2);
      // Single 5-star review on the low-volume course.
      const r4 = addStudent();
      addReview(r4.id, lowVolume.id, 5);

      // (2 + 2 + 2 + 5) / 4 = 2.75 — not the (2 + 5) / 2 = 3.5 a per-course
      // average would give.
      expect(getPlatformTotals().averageRating).toBe(2.75);
    });

    it("returns a null average rating and zeros for an inactive platform", () => {
      // Only base.course exists; no purchases, enrollments, or reviews.
      expect(getPlatformTotals()).toEqual({
        totalRevenue: 0,
        totalEnrollments: 0,
        publishedCourses: 1,
        instructorCount: 1,
        averageRating: null,
      });
    });
  });

  // ─── Instructor revenue leaderboard ───

  describe("getInstructorRevenueLeaderboard", () => {
    it("attributes revenue by course ownership, summed across an instructor's courses", () => {
      const owner = addInstructor("Owner");
      const c1 = addCourse(owner.id, schema.CourseStatus.Published);
      const c2 = addCourse(owner.id, schema.CourseStatus.Archived);

      const a = addStudent();
      const b = addStudent();
      addPurchase(a.id, c1.id, 4000);
      addPurchase(b.id, c2.id, 1000);

      const row = getInstructorRevenueLeaderboard().find(
        (r) => r.instructorId === owner.id
      );
      expect(row).toEqual({
        instructorId: owner.id,
        instructorName: "Owner",
        revenue: 5000,
      });
    });

    it("counts a team/bundle purchase at its full bundle price against the owner", () => {
      const owner = addInstructor("Bundle Owner");
      const course = addCourse(owner.id, schema.CourseStatus.Published);

      const buyer = addStudent();
      // One purchase row at the full bundle price, plus 5 seat coupons.
      addTeamPurchase(buyer.id, course.id, 5, 10000);

      const row = getInstructorRevenueLeaderboard().find(
        (r) => r.instructorId === owner.id
      );
      expect(row?.revenue).toBe(10000);
    });

    it("sorts by revenue descending, breaking ties alphabetically by name", () => {
      const carl = addInstructor("Carl");
      const adam = addInstructor("Adam");
      const beth = addInstructor("Beth");
      const cc = addCourse(carl.id, schema.CourseStatus.Published);
      const ac = addCourse(adam.id, schema.CourseStatus.Published);
      const bc = addCourse(beth.id, schema.CourseStatus.Published);

      const s = addStudent();
      addPurchase(s.id, cc.id, 9000);
      addPurchase(s.id, ac.id, 5000);
      addPurchase(s.id, bc.id, 5000); // ties with Adam → alphabetical

      // base instructor ("Test Instructor") owns base.course with no sales → 0.
      expect(getInstructorRevenueLeaderboard()).toEqual([
        { instructorId: carl.id, instructorName: "Carl", revenue: 9000 },
        { instructorId: adam.id, instructorName: "Adam", revenue: 5000 },
        { instructorId: beth.id, instructorName: "Beth", revenue: 5000 },
        {
          instructorId: base.instructor.id,
          instructorName: "Test Instructor",
          revenue: 0,
        },
      ]);
    });

    it("includes an instructor who owns courses but has made no sales, at zero revenue", () => {
      const noSales = addInstructor("No Sales");
      addCourse(noSales.id, schema.CourseStatus.Published);

      const row = getInstructorRevenueLeaderboard().find(
        (r) => r.instructorId === noSales.id
      );
      expect(row).toEqual({
        instructorId: noSales.id,
        instructorName: "No Sales",
        revenue: 0,
      });
    });
  });
});
