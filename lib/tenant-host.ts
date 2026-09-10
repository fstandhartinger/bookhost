// Also tolerate NULL rows during the expand phase; never change the legacy domain.
export function tenantHost(row: {
  slug: string;
  host?: string | null;
}): string {
  return row.host ?? `${row.slug}.wissen.app.mintapis.com`;
}
