// One UTC window and query shared by the admin page and CLI. Visits are unique
// per UTC day and source; they are not cross-day people or conversion cohorts.
export async function analyticsReport(db) {
  // Writers of record: db/migrations/012_analytics.sql triggers write
  // workspace_created, intake_draft and intake_published; lib/billing.ts
  // writes paid_conversion. Do not add app-level writers for these events.
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
        count(*) FILTER (WHERE name='intake_published')::int AS intake_published,
        count(*) FILTER (WHERE name='paid_conversion')::int AS paid_conversion
      FROM events WHERE ts >= (date_trunc('day',now() AT TIME ZONE 'UTC')-interval '13 days') AT TIME ZONE 'UTC'
      GROUP BY 1,2
    ) SELECT COALESCE(v.day,f.day)::text AS day, COALESCE(v.source,f.source) AS source,
      COALESCE(visits,0) AS visits, COALESCE(demo_click,0) AS demo_click,
      COALESCE(checkout_start,0) AS checkout_start, COALESCE(trial_started,0) AS trial_started,
      COALESCE(workspace_created,0) AS workspace_created, COALESCE(intake_draft,0) AS intake_draft,
      COALESCE(intake_published,0) AS intake_published,
      COALESCE(paid_conversion,0) AS paid_conversion
    FROM visits v FULL JOIN funnel f USING(day,source) ORDER BY 1,2`);
  // Which sites send people here? Kept separate from the funnel table because
  // events carry no referrer, so joining the two would pair visits from one
  // channel with conversions attributed to "(direct)".
  const { rows: referrerRows } = await db.query(`
    SELECT referrer_host AS host, count(DISTINCT visitor_hash)::int AS visits
    FROM page_views
    WHERE referrer_host IS NOT NULL
      AND ts >= (date_trunc('day',now() AT TIME ZONE 'UTC')-interval '13 days') AT TIME ZONE 'UTC'
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 25`);
  const { rows: pageRows } = await db.query(`
    SELECT path, count(*)::int AS visits, count(DISTINCT visitor_hash)::int AS uniques
    FROM page_views
    WHERE ts >= (date_trunc('day',now() AT TIME ZONE 'UTC')-interval '13 days') AT TIME ZONE 'UTC'
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 25`);
  const metrics = [
    "visits",
    "demo_click",
    "checkout_start",
    "trial_started",
    "workspace_created",
    "intake_draft",
    "intake_published",
    "paid_conversion",
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
    referrers: referrerRows.map((row) => ({
      host: row.host,
      visits: row.visits,
    })),
    pages: pageRows.map((row) => ({
      path: row.path,
      visits: row.visits,
      uniques: row.uniques,
    })),
    sources: [...sources]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, counts]) => ({ source, ...counts })),
    days: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({ day, ...counts })),
  };
}

// Aggregate for GET /api/operator/visits?days=N. The caller validates days as an
// integer 1..90; the guard keeps the window bounded if the function is ever
// reused elsewhere. days is only ever a query parameter, never SQL text.
export async function operatorVisits(db, days) {
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new RangeError("days must be an integer between 1 and 90");
  const since = `(date_trunc('day',now() AT TIME ZONE 'UTC')-($1::int-1)*interval '1 day') AT TIME ZONE 'UTC'`;
  const { rows: dayRows } = await db.query(
    `
    SELECT (ts AT TIME ZONE 'UTC')::date::text AS date, count(*)::int AS visits,
      count(DISTINCT visitor_hash)::int AS uniques
    FROM page_views WHERE ts >= ${since}
    GROUP BY 1`,
    [days],
  );
  const { rows: pageRows } = await db.query(
    `
    SELECT path, count(*)::int AS visits, count(DISTINCT visitor_hash)::int AS uniques
    FROM page_views WHERE ts >= ${since}
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 25`,
    [days],
  );
  const { rows: referrerRows } = await db.query(
    `
    SELECT referrer_host AS host, count(*)::int AS visits, count(DISTINCT visitor_hash)::int AS uniques
    FROM page_views
    WHERE referrer_host IS NOT NULL AND ts >= ${since}
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 25`,
    [days],
  );
  const series = [];
  const today = new Date();
  for (let ago = days - 1; ago >= 0; ago--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - ago);
    series.push({ date: date.toISOString().slice(0, 10), visits: 0, uniques: 0 });
  }
  const byDate = new Map(series.map((entry) => [entry.date, entry]));
  for (const row of dayRows) {
    const target = byDate.get(String(row.date));
    if (target) {
      target.visits = Number(row.visits);
      target.uniques = Number(row.uniques);
    }
  }
  return {
    days: series,
    topPages: pageRows.map((row) => ({
      path: row.path,
      visits: row.visits,
      uniques: row.uniques,
    })),
    topReferrers: referrerRows.map((row) => ({
      host: row.host,
      visits: row.visits,
      uniques: row.uniques,
    })),
  };
}
