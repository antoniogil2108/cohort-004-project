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

// Import after mock so the module picks up our test db
import {
  upsertReview,
  getUserReview,
  getCourseRatingStats,
  getRatingStatsForCourses,
} from "./reviewService";

function createStudent(name: string, email: string) {
  return testDb
    .insert(schema.users)
    .values({ name, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

function createCourse(title: string, slug: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug,
      description: "Another course",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

describe("reviewService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("upsertReview", () => {
    it("inserts a new rating", () => {
      const review = upsertReview(base.user.id, base.course.id, 4);

      expect(review).toBeDefined();
      expect(review.userId).toBe(base.user.id);
      expect(review.courseId).toBe(base.course.id);
      expect(review.rating).toBe(4);
    });

    it("updates the existing rating instead of duplicating", () => {
      upsertReview(base.user.id, base.course.id, 3);
      upsertReview(base.user.id, base.course.id, 5);

      const stats = getCourseRatingStats(base.course.id);
      expect(stats.count).toBe(1);
      expect(stats.average).toBe(5);

      const review = getUserReview(base.user.id, base.course.id);
      expect(review!.rating).toBe(5);
    });
  });

  describe("getUserReview", () => {
    it("returns the user's review when it exists", () => {
      upsertReview(base.user.id, base.course.id, 2);

      const review = getUserReview(base.user.id, base.course.id);
      expect(review).toBeDefined();
      expect(review!.rating).toBe(2);
    });

    it("returns undefined when no review exists", () => {
      expect(getUserReview(base.user.id, base.course.id)).toBeUndefined();
    });
  });

  describe("getCourseRatingStats", () => {
    it("averages ratings across students", () => {
      const student2 = createStudent("Student Two", "student2@example.com");

      upsertReview(base.user.id, base.course.id, 5);
      upsertReview(student2.id, base.course.id, 3);

      const stats = getCourseRatingStats(base.course.id);
      expect(stats.count).toBe(2);
      expect(stats.average).toBe(4);
    });

    it("returns null average and zero count when there are no ratings", () => {
      const stats = getCourseRatingStats(base.course.id);
      expect(stats).toEqual({ average: null, count: 0 });
    });
  });

  describe("getRatingStatsForCourses", () => {
    it("returns a map of stats keyed by course id", () => {
      const course2 = createCourse("Second Course", "second-course");
      const student2 = createStudent("Student Two", "student2@example.com");

      upsertReview(base.user.id, base.course.id, 4);
      upsertReview(student2.id, base.course.id, 2);
      upsertReview(base.user.id, course2.id, 5);

      const stats = getRatingStatsForCourses([base.course.id, course2.id]);

      expect(stats.get(base.course.id)).toEqual({ average: 3, count: 2 });
      expect(stats.get(course2.id)).toEqual({ average: 5, count: 1 });
    });

    it("omits courses with no ratings", () => {
      upsertReview(base.user.id, base.course.id, 4);

      const stats = getRatingStatsForCourses([base.course.id, 9999]);
      expect(stats.has(9999)).toBe(false);
    });

    it("returns an empty map for an empty input", () => {
      expect(getRatingStatsForCourses([]).size).toBe(0);
    });
  });
});
