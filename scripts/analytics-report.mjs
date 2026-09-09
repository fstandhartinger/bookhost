// One UTC window and query shared by the admin page and CLI. Visits are unique
// per UTC day and source; they are not cross-day people or conversion cohorts.
export async function analyticsReport(db) {
  const { rows } = await db.query(`
    WITH visits AS (
      SELECT (ts AT TIME ZONE 'UTC')::date AS day, COALESCE(utm_source,'(direct)') AS source,
        count(DISTINCT visitor_hash)::int AS visits
      FROM page_views WHERE ts >= (date_trunc('day',now() AT TIME ZONE 'UTC')-interval '13 days') AT TIME ZONE 'UTC'
      GROUP BY 1,2
    ), funnel AS (
      SELECT (ts AT TIME ZONE 'UTC')::date AS day, COALESCE(utm_source,'(direct)') AS source,
        count(*) FILTER (WHERE name='demo_click')::int AS demo_click,
        count(*) FILTER (WHERE name='checkout_start')::int AS checkout_start,
        count(*) FILTER (WHERE name='trial_started')::int AS trial_started,
        count(*) FILTER (WHERE name='workspace_created')::int AS workspace_created,
        count(*) FILTER (WHERE name='intake_draft')::int AS intake_draft,
        count(*) FILTER (WHERE name='intake_published')::int AS intake_published
      FROM events WHERE ts >= (date_trunc('day',now() AT TIME ZONE 'UTC')-interval '13 days') AT TIME ZONE 'UTC'
      GROUP BY 1,2
    ) SELECT COALESCE(v.day,f.day)::text AS day, COALESCE(v.source,f.source) AS source,
      COALESCE(visits,0) AS visits, COALESCE(demo_click,0) AS demo_click,
      COALESCE(checkout_start,0) AS checkout_start, COALESCE(trial_started,0) AS trial_started,
      COALESCE(workspace_created,0) AS workspace_created, COALESCE(intake_draft,0) AS intake_draft,
      COALESCE(intake_published,0) AS intake_published
    FROM visits v FULL JOIN funnel f USING(day,source) ORDER BY 1,2`);
  const metrics = [
    "visits",
    "demo_click",
    "checkout_start",
    "trial_started",
    "workspace_created",
    "intake_draft",
    "intake_published",
  ];
  const empty = () => Object.fromEntries(metrics.map((k) => [k, 0]));
  const sources = new Map();
  const days = new Map();
  for (let ago = 13; ago >= 0; ago--) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - ago);
    days.set(date.toISOString().slice(0, 10), empty());
  }
  for (const row of rows) {
    if (!sources.has(row.source)) sources.set(row.source, empty());
    if (!days.has(row.day)) days.set(row.day, empty());
    for (const key of metrics) {
      sources.get(row.source)[key] += Number(row[key]);
      days.get(row.day)[key] += Number(row[key]);
    }
  }
  return {
    sources: [...sources]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, counts]) => ({ source, ...counts })),
    days: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({ day, ...counts })),
  };
}
