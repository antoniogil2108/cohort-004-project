# Plan — Platform Analytics (Admin) v1

> Source PRD: [`prd-platform-analytics-admin-v1`](./prd-platform-analytics-admin-v1)
> Approach: red → green → refactor on the service (TDD), then a thin, untested route/UI
> wiring phase. Vertical slices — one test → one impl, never batch tests.
> Sibling of the per-course work in [`plan-instructor-analytics-v1.md`](./plan-instructor-analytics-v1.md);
> deliberately a **separate module** because the grain is platform-wide, not `courseId`-scoped.

## Decisions (PRD-aligned)

- **Scope split:** Phase 1 builds & tests `adminAnalyticsService` end-to-end (TDD). Phase 2
  wires the `/admin/analytics` route + sidebar item + page UI — not TDD'd, consistent with the
  other `admin.*` routes (no loader/component tests).
- **"Instructor" = course owner** (`distinct courses.instructorId`), used identically for the KPI
  card count and the leaderboard rows so the count equals the number of rows. Role is never used.
- **Status handling:** revenue, enrollments, and the leaderboard count courses of **any** status
  (historical truth). Only the "published courses" KPI filters to `published`.
- **Currency:** total revenue renders as `$0.00` even at zero — a dedicated currency formatter,
  **not** the existing price formatter that prints `0` as "Free".
- **No schema changes.** All data exists: `purchases`, `enrollments`, `courses`,
  `courseReviews`, `users`.

## Files

- `app/services/adminAnalyticsService.ts` (new)
- `app/services/adminAnalyticsService.test.ts` (new)
- `app/routes/admin.analytics.tsx` (new — Phase 2)
- `app/components/sidebar.tsx` (edit — Phase 2; add Analytics item to the Admin nav group)

The test mirrors the existing service-test harness exactly (`app/services/analyticsService.test.ts`):
`vi.mock("~/db")` returning the in-memory `testDb`, `createTestDb()` + `seedBaseData()` from
`~/test/setup` in `beforeEach`, import the service after the mock, small local seed helpers per test
so expected totals stay obvious by inspection. Assert returned values only — never SQL or query counts.

## Public interface

```ts
export type PlatformTotals = {
  totalRevenue: number; // sum(purchases.pricePaid), all courses, all statuses
  totalEnrollments: number; // count(enrollments), all statuses
  publishedCourses: number; // count(courses where status = published)
  instructorCount: number; // count(distinct courses.instructorId)
  averageRating: number | null; // review-weighted avg(courseReviews.rating); null when no reviews
};

export function getPlatformTotals(): PlatformTotals;

export type InstructorRevenueRow = {
  instructorId: number;
  instructorName: string;
  revenue: number; // sum(pricePaid) over courses they own
};

// One row per distinct owner; revenue desc, then name asc; zero-revenue owners included.
export function getInstructorRevenueLeaderboard(): InstructorRevenueRow[];
```

**Set-based only.** `getPlatformTotals` is a handful of independent aggregate selects (no per-course
loop). `getInstructorRevenueLeaderboard` is a single `GROUP BY courses.instructorId` joined to
`users` for the name and left-joined to `purchases` so owners with no sales still surface at `0`.

**Average rating is review-weighted** — `avg(courseReviews.rating)` across all review rows (each
review counts once), so a one-review course can't outweigh a high-volume one. `null` when there are
zero reviews; the card renders `—`.

## Phase 1 — `adminAnalyticsService` via TDD

Seed helper `seedPlatformFixture(testDb)` extending `seedBaseData`: several instructors each owning
one or more courses across **published / draft / archived**; individual + team/bundle purchases with
varied `pricePaid` (bundle counted at full price against the owner); enrollments across statuses;
course reviews spread so one course is high-volume and another single-review; plus at least one
instructor who owns a course but has **zero** sales.

Slice order (vertical: one test → one impl, never batch):

1. **`getPlatformTotals` — total revenue** (tracer bullet; stands up the fixture). Revenue sums
   across statuses: a published, a draft, and an archived course all contribute.
2. **total enrollments** — counts all statuses.
3. **published-course count** — only `published`, while revenue/enrollments stay all-status.
4. **instructor count** — equals the number of distinct course owners.
5. **average rating (weighted)** — high-volume course pulls the average more than a single-review one.
6. **average rating null path** — no reviews → `null`; the all-zero / empty platform case.
7. **`getInstructorRevenueLeaderboard` — ownership attribution** — revenue summed across an
   instructor's multiple courses.
8. **bundle purchase** — a team/bundle purchase counted at full price against the owner.
9. **ordering** — revenue descending with alphabetical name tie-break.
10. **zero-sales owner** — an instructor who owns courses but has no sales still appears at `0`.

Each function gets happy / empty-zero / its specific edge (per the PRD Testing Decisions). Refactor
shared bits (e.g. a distinct-owner CTE/helper) only after green.

## Phase 2 — route + sidebar + UI (separate, not TDD'd)

**Route** `app/routes/admin.analytics.tsx` — new flat `admin.*` route inside the app layout, sibling
of `admin.courses` / `admin.users` / `admin.categories`. Reuse the exact admin gate those use
(copy from `admin.courses.tsx`): `getCurrentUserId` → 401 when absent; `getUserById` →
403 when `role !== UserRole.Admin`. Loader stays thin: calls `getPlatformTotals()` and
`getInstructorRevenueLeaderboard()`, returns their plain data, no computation. Include `meta`,
`HydrateFallback` (skeleton), and an `ErrorBoundary` mirroring `admin.courses.tsx`.

**Sidebar** `app/components/sidebar.tsx` — add an "Analytics" item to the Admin nav group
(`roles: [UserRole.Admin]`, alongside Manage Users / Manage Courses / Categories) with a
chart-style icon (e.g. `BarChart3` from lucide), pointing at `/admin/analytics`.

**UI** — hand-rolled Tailwind, no new deps:

- **KPI card row** reusing the instructor-analytics card idiom: Total Revenue (currency, `$0.00`
  at zero), Total Enrollments, Published Courses, Instructors, Avg Rating (`—` when `null`).
- **Leaderboard** reusing the admin table idiom from `admin.courses.tsx` (`Card` →
  `overflow-x-auto` → `<table>` with the `bg-muted/50` header row). Full, unpaginated; columns:
  Instructor (plain text — no per-instructor page to link), Revenue. Rows already sorted by the service.
- **Empty state** when the platform has no courses at all (friendly message, mirroring the
  `courses.length === 0` card in `admin.courses.tsx`). Once ≥1 course exists, everything degrades
  gracefully — zeros, `$0.00`, `—`, an empty leaderboard body.

## Out of scope (v1)

Trend charts, date-range/windowed metrics, per-course & per-category breakdowns, a platform-wide
completion rate, extra leaderboard columns or "% of revenue" share, engagement funnels, a
per-instructor detail page, and data export — all deferred (see PRD "Out of Scope").
