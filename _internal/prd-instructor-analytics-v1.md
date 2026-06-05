# Instructor Analytics dashboard (v1) — per-course Analytics tab

> Origin: [GitHub issue #2](https://github.com/antoniogil2108/cohort-004-project/issues/2) · label `ready-for-agent`
> Recuperado das issues do GitHub para o repositório.

## Problem Statement

As an instructor, when I open one of my courses in the editor I can manage its content, settings, sales copy, and student roster — but I have no way to see how the course is actually *performing*. I can't tell how it's selling, whether students who enrol actually finish, or where in the curriculum they give up. I'm flying blind: I can't tell a healthy course from a struggling one, and I can't tell which lesson is the wall people hit. I need a single place, scoped to one course, where I can see its health at a glance and then dig into the specifics.

## Solution

A new **Analytics** tab inside the course editor (`/instructor/:courseId`), sitting alongside Content / Settings / Sales Copy / Students. Opening it shows:

- A **KPI summary row** at the top — revenue, seats sold, enrolments, completion rate, average rating — so the instructor sees course health in one glance.
- A **Sales** section (hidden for free courses) — total revenue, seats sold, a monthly revenue trend, and a top-countries breakdown.
- A **Completion** section — what share of enrolees have finished the course, the distribution of how far everyone has got, and average progress.
- A **Lesson drop-off funnel** — per lesson, in course order, what share of enrolees *reached* (opened) it, with the biggest consecutive drop highlighted as the drop-off point, plus an "avg % watched" signal per lesson to distinguish "never opened" from "opened but bailed early."
- An **Enrolment trend** — monthly enrolment counts (the headline growth metric for free courses).
- A **Ratings** section — average rating, review count, and star distribution.

Everything is computed from existing data with set-based SQL aggregates, rendered with hand-rolled Tailwind bars (no charting dependency), and degrades gracefully via empty states when a course has no data yet.

## User Stories

1. As an instructor, I want an Analytics tab on my course editor page, so that I have a dedicated place to see how that course is performing.
2. As an instructor, I want the Analytics tab to sit alongside Content / Settings / Sales Copy / Students, so that it fits the editing workflow I already know.
3. As an instructor, I want only the owner of a course (or an admin) to view its analytics, so that my course's sales and performance data stays private.
4. As an instructor, I want a row of headline KPI cards at the top of the tab, so that I can read overall course health in one glance without scrolling.
5. As an instructor, I want the KPI row to show total revenue, so that I immediately know how much the course has earned.
6. As an instructor, I want the KPI row to show seats sold, so that I know my sales volume at a glance.
7. As an instructor, I want the KPI row to show total enrolments, so that I know how many students have access.
8. As an instructor, I want the KPI row to show completion rate, so that I know what share of students finish.
9. As an instructor, I want the KPI row to show average rating, so that I know how the course is received.
10. As an instructor of a paid course, I want a Sales section, so that I can understand my course's commercial performance.
11. As an instructor, I want total revenue computed from what students actually paid, so that the number reflects real earnings including regional pricing and discounts.
12. As an instructor, I want a team purchase counted as the seats it bought, not as a single sale, so that bulk deals aren't undercounted in my sales volume.
13. As an instructor, I want a monthly revenue trend, so that I can see whether sales are growing or slowing over time.
14. As an instructor, I want a top-countries breakdown of sales, so that I understand where my buyers are.
15. As an instructor of a free course, I want the Sales section and revenue card hidden entirely, so that I'm not shown empty or meaningless money figures.
16. As an instructor of a free course, I want enrolment to be my headline growth metric instead of revenue, so that I still have a meaningful top-line number.
17. As an instructor, I want a Completion section, so that I can see whether enrolees actually finish the course.
18. As an instructor, I want completion rate measured over all enrolees, so that students who enrolled but never started are honestly reflected.
19. As an instructor, I want completion to use the same definition students see in their own progress bar, so that my numbers never contradict theirs.
20. As an instructor, I want a distribution of how far students have progressed, so that I can see whether people cluster near the start, middle, or finish.
21. As an instructor, I want an average progress figure, so that I have a single summary of how far the typical student gets.
22. As an instructor, I want a lesson drop-off funnel in course order, so that I can find where students stop showing up.
23. As an instructor, I want each lesson's bar to show the share of enrolees who opened it, so that I can see reach decline lesson by lesson.
24. As an instructor, I want the largest consecutive drop highlighted, so that I can immediately spot the single biggest drop-off point.
25. As an instructor, I want an "avg % watched" figure per lesson, so that I can tell "nobody opened this" apart from "people open it but quit partway through."
26. As an instructor, I want the avg % watched to be labelled approximate where video duration isn't known, so that I don't over-trust an estimated figure.
27. As an instructor, I want an enrolment trend by month, so that I can see whether interest in the course is growing.
28. As an instructor, I want a ratings summary with average and count, so that I know how well the course is received and by how many people.
29. As an instructor, I want a star distribution, so that I can see whether ratings are polarised or consistent.
30. As an instructor of a brand-new course with no enrolments, I want one friendly empty state for the whole tab, so that I'm not confronted with a wall of zeros.
31. As an instructor whose course has enrolments but no reviews, I want the Ratings section to show its own empty state, so that the rest of the tab still renders.
32. As an instructor whose course has enrolments but no lessons, I want the drop-off funnel to show its own empty state, so that the section degrades gracefully.
33. As an instructor of a draft course, I want analytics to behave the same as any zero-data course, so that drafts don't need special handling or error.
34. As an instructor, I want all the charts to load quickly, so that the tab is usable even as my course grows.
35. As an instructor, I want the analytics numbers to be accurate as of the moment I load the page, so that I can trust what I'm looking at.
36. As an admin, I want to view any course's analytics, so that I can support instructors and audit course health.

## Implementation Decisions

**Placement.** A new Analytics tab is added to the existing course editor route for `/instructor/:courseId`, alongside the current Content / Settings / Sales Copy / Students tabs. It reuses that route's existing owner-or-admin ownership check — no new authorization logic.

**New module: `analyticsService`.** All metrics live in a new `analyticsService` (with an accompanying `analyticsService.test`, per the repo's service-test rule). The module exposes **one set-based aggregate function per metric** — `GROUP BY` / `sum` / `count` queries that compute results in SQLite. No per-student N+1 loops. The route loader stays thin: it calls the service functions and passes plain data to the component.

**Function shape.** New service functions follow the existing positional-parameter convention used across the service layer (the object-parameter rule in CLAUDE.md applies to multi-param-of-same-type cases; single `courseId` aggregates take a plain argument like the surrounding services). Each returns plain serialisable data (numbers, arrays of `{ label, value }`-style rows) ready for the loader.

**KPI summary row.** Rendered from numbers the sections already compute — no additional queries dedicated to the KPI row. Cards: revenue, seats sold, enrolments, completion rate, average rating. The revenue card is omitted when the course price is 0.

**Sales section** (rendered only when course price > 0):
- **Revenue** = sum of `pricePaid` across the course's purchases. A team purchase records a single purchase row whose `pricePaid` is the bundle total, so summing `pricePaid` yields correct gross revenue for both individual and team purchases.
- **Seats sold** = count of coupons for the course (each coupon = one paid seat, redeemed or not) **plus** count of purchases for the course that are *not* referenced by any coupon (i.e. individual purchases). This avoids undercounting team purchases, which generate one purchase row but many seats.
- **Monthly revenue trend** = purchases bucketed by month of creation.
- **Top countries** = purchases grouped by country.
- Optional secondary stat: seats activated (redeemed coupons ÷ seats sold).

**Completion section:**
- **Completion rate** = (enrolees who have completed every lesson) ÷ (all enrolees). The denominator is all enrolments; no-shows count against the rate.
- "Completed the course" uses the same definition as the learner-facing progress everywhere in the app: completed lessons ÷ total lessons, unweighted and excluding quizzes. Computed as a set-based aggregate, not by calling the per-student progress function in a loop.
- **`enrollments.completedAt` must NOT be used** — it is dead data; the function that would set it is never called from any route or UI. Completion is derived purely from lesson progress.
- **Progress distribution** = one grouped query over lesson-progress rows, bucketed by completion percentage in application code.
- **Average progress** = average completion percentage across enrolees.

**Lesson drop-off funnel:**
- Lessons are flattened into course order (module position, then lesson position).
- **Reach %** per lesson = share of enrolees who have *any* lesson-progress row for that lesson. A progress row is created when an enrolled student opens the lesson page, so a row means "opened it." Reach is chosen over completion deliberately: "drop-off" means where students stop showing up, and completion is already covered by the Completion section.
- The **largest consecutive drop** between adjacent lessons (in order) is highlighted as the drop-off point.
- **Avg % watched** per lesson = average, across viewers, of each viewer's furthest video position divided by the video duration. The player emits a position ping roughly every 10 seconds, so the furthest-position signal is dense. Duration denominator: use the lesson's stored duration in minutes (×60) when present; otherwise fall back to the maximum position observed across all viewers of that lesson, and label the figure approximate (the real video duration is not persisted).

**Enrolment trend** = enrolments bucketed by month of enrolment.

**Ratings section** = average rating, review count, and star distribution (count per 1–5) from the course's reviews.

**Trends / bucketing.** Monthly buckets covering the last 12 months (or from the course's first month if the course is younger), zero-filled in application code so empty months render as gaps. Bucketing is by month of the stored timestamp (UTC).

**Empty states.** A top-level guard: a course with zero enrolments renders one friendly empty state for the whole tab. Otherwise every section renders, each with its own local empty state (free course → no Sales; no lessons → no funnel; no reviews → no Ratings). Drafts get no special handling and behave like any zero-data course.

**Charts.** All visualisations are hand-rolled Tailwind bars following the existing progress-bar div idiom. No new charting dependency is introduced.

## Testing Decisions

**What makes a good test here.** Tests assert on the **values returned by the `analyticsService` aggregate functions** given a seeded database — external behavior, not how the SQL is written. A good test seeds a known fixture (e.g. three enrolees, two of whom completed; one individual purchase plus a team purchase of five coupons; a handful of watch events) and asserts the function returns the expected revenue, seats sold, reach percentages, completion rate, avg-% -watched, and bucketed trend arrays. Tests should not assert on query structure, column aliases, or internal helpers.

**Modules tested.** `analyticsService` is the unit under test, with a dedicated `analyticsService.test`. Each exported aggregate function gets its own `describe` block with cases for: the happy path, the empty/zero-data path, and the edges specific to that metric (free course → Sales hidden; team purchase → seats counted as coupons not as one row; no-show enrolee → counts against completion; lesson nobody opened → 0% reach; lesson with no stored duration → approximate avg-% -watched via max observed position; month with no activity → zero-filled bucket).

**Prior art.** Mirror the existing service tests exactly — `purchaseService.test`, `progressService.test`, `enrollmentService.test`. They use `createTestDb()` (in-memory SQLite migrated with the real Drizzle migrations) plus `vi.mock("~/db")` to point the service at the test database, seed via `seedBaseData()`, and assert on returned values. The analytics tests will extend the seed with the additional rows each aggregate needs (modules, lessons, enrolments, lesson progress, purchases, coupons, course reviews, video watch events) — this is the richest fixture of any service test in the repo so far.

**Seam note.** The Analytics route loader stays thin (calls the service, passes data to the component) and is covered by the service tests plus the existing route's ownership check; no new loader-level or component-level test is added.

## Out of Scope

- **Full within-video retention curve** (a heatmap of where viewers drop inside each video). v1 ships only the single per-lesson avg-% -watched figure; the full curve is deferred.
- **Quiz performance** (per-quiz pass rate / average score, best-attempt-per-student). The data exists and is clean, but it is explicitly deferred to a later version.
- **Comments / engagement metrics.**
- **Active-students / recency metrics** — there is no reliable activity timestamp on lesson progress to support them.
- **Portfolio roll-up on `/instructor`** — aggregate analytics across all of an instructor's courses. v1 is strictly per-course.
- **Date-range filtering / custom periods** — trends are a fixed last-12-months window; there is no user-selectable range.
- **Persisting real video duration** — out of scope; the avg-% -watched denominator is approximated where duration is unknown.
- **Any new charting library or visualization dependency.**

## Further Notes

- This PRD supersedes earlier informal notes that based the drop-off funnel on completion and treated "units sold" as a raw purchase count; both were changed during design (funnel → reach, units → seats sold), and a KPI summary row was added.
- The seats-sold definition leans on the fact that team purchases generate coupons referencing a single purchase row. If the purchase/coupon model changes, the seats-sold aggregate must be revisited.
- The completion definition is intentionally pinned to the unweighted, no-quiz lesson-ratio used at every learner-facing call site so instructor figures never diverge from what students see.
- Revenue and avg-% -watched both rely on stored integers/positions; formatting (currency, percentages) should follow the existing course price/progress display conventions.
