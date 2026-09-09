import { NextRequest, NextResponse } from "next/server";
import { LEGACY_HOSTS, PUBLIC_BASE_URL, TENANT_DOMAIN } from "./lib/config";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (process.env.REDIRECT_LEGACY_HOSTS !== "true" || pathname.startsWith("/api/") || pathname === "/healthz") {
    return NextResponse.next();
  }

  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tenantSuffix = `.${TENANT_DOMAIN.toLowerCase()}`;
  if (host.endsWith(tenantSuffix) || !LEGACY_HOSTS.includes(host)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(`${PUBLIC_BASE_URL}${pathname}${search}`, 301);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
