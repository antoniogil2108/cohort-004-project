# Plan — `analyticsService` via TDD (Instructor Analytics v1)

> Source PRD: [`prd-instructor-analytics-v1.md`](./prd-instructor-analytics-v1.md)
> Approach: red → green → refactor, vertical slices (one test → one impl, never batch tests).

## Decisions (open questions resolved to PRD-aligned defaults)

- **Scope:** Phase 1 builds & tests `analyticsService` end-to-end. Route/UI wiring is a
  separate Phase 2, not TDD'd (the PRD keeps the loader thin and adds no loader/component test).
- **Funnel:** single deep `getDropOffFunnel(courseId)` — runs both grouped queries
  (reach + avg-watched) and computes the largest-consecutive-drop highlight internally,
  so the drop-point logic is covered by service tests.
- **Ratings:** `analyticsService` owns the full `getRatingDistribution` (average + count +
  per-star) so analytics is self-contained.

## Files

- `app/services/analyticsService.ts` (new)
- `app/services/analyticsService.test.ts` (new)

Mirrors the existing service-test harness exactly: `vi.mock("~/db")` returning the in-memory
`testDb`, `createTestDb()` + `seedBaseData()` in `beforeEach`, local seed helpers for the rich
fixture, positional params, one `describe` per exported function.

## Public interface

```ts
// Sales (price > 0)
getRevenue(courseId): number                          // sum(pricePaid)
getSeatsSold(courseId): number                         // coupon count + purchases not referenced by any coupon
getMonthlyRevenueTrend(courseId): { month, value }[]   // last 12mo (or since course start), zero-filled, UTC
getTopCountries(courseId): { country, value }[]

// Completion (set-based; never loops calculateProgress)
getCompletionRate(courseId): number                    // enrolees who completed every lesson / all enrolees
getAverageProgress(courseId): number
getProgressDistribution(courseId): { bucket, value }[]

// Drop-off funnel (deep module)
getDropOffFunnel(courseId): {
  lessonId, title, reachPct, avgPctWatched, watchedApproximate, isDropOffPoint
}[]                                                    // lessons flattened by module.position, lesson.position

// Enrolment trend
getMonthlyEnrollmentTrend(courseId): { month, value }[]  // zero-filled

// Ratings
getRatingDistribution(courseId): { average, count, stars: { rating, value }[] }
```

**Completion definition** is pinned to the learner-facing one: completed lessons ÷ total
lessons, unweighted, quizzes excluded — same as `calculateProgress(userId, courseId, false, false)`,
but expressed as a single set-based query (GROUP BY user, count completed vs. course total),
not a per-student loop. `enrollments.completedAt` is **not** read (dead data per PRD).

**Seats sold** = `count(coupons for course)` + `count(purchases for course whose id is not
referenced by any coupon)` — so a team purchase counts as its seats, not as one row.

## Seed helper (richest fixture in the repo)

A `seedAnalyticsFixture(testDb)` helper extending `seedBaseData` with: modules + ordered lessons
(some with `durationMinutes`, some null), enrolments across months, lesson-progress rows
(completed / in-progress / none, incl. a no-show enrolee), individual + team purchases with
`pricePaid`/`country`/`createdAt`, coupons (redeemed and not), course reviews across stars,
and `videoWatchEvents` at varied `positionSeconds`.

## Slice order (vertical: one test → one impl, never batch tests)

1. **`getRevenue`** — tracer bullet; stands up the fixture helpers
2. **`getSeatsSold`** — team-purchase-vs-coupon edge
3. `getMonthlyRevenueTrend` — zero-fill bucketing (month with no activity → zero bucket)
4. `getTopCountries`
5. **`getCompletionRate`** — set-based completion + no-show enrolee counts against rate
6. `getAverageProgress`
7. `getProgressDistribution`
8. **`getDropOffFunnel`** — reach % (incl. lesson nobody opened → 0%), avg-%-watched,
   `watchedApproximate` fallback to max observed position when `durationMinutes` is null,
   `isDropOffPoint` on largest consecutive drop
9. `getMonthlyEnrollmentTrend`
10. `getRatingDistribution` — average/count + per-star counts; empty-reviews path

Each function gets **happy / empty-zero / its specific edge** (per the PRD's Testing Decisions),
asserting only on returned values — never query structure. Refactor (extract month-bucketing +
course-lesson-ordering helpers) only after green.

## Phase 2 (separate, on request) — route/UI

Add the **Analytics** tab to `app/routes/instructor.$courseId.tsx` (reusing its existing
owner-or-admin check), compose the KPI row + zero-enrolment guard in the loader, render
hand-rolled Tailwind bars (existing progress-bar div idiom), omit the revenue card when
`course.price === 0`. No new charting dep; no new loader/component test.
