"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

export type HeaderLink = {
  href: string;
  label: string;
  className: string;
  callToAction?: boolean;
};

// Every /app route redirects unauthenticated visitors to /login, so anyone on
// an /app path is signed in: "Log in" and the trial CTA would be noise there.
export function headerLinksFor(pathname: string | null): HeaderLink[] {
  const path = pathname ?? "";
  if (path === "/app" || path.startsWith("/app/")) {
    return [
      {
        href: "/app",
        label: "Your workspace",
        className: "whitespace-nowrap hover:underline",
      },
    ];
  }
  return [
    {
      href: "/pricing",
      label: "Pricing",
      className: "hidden hover:underline sm:inline",
    },
    {
      href: "/login",
      label: "Log in",
      className: "whitespace-nowrap hover:underline",
    },
    {
      href: "/pricing",
      label: "Try BookHost ↗",
      className: "whitespace-nowrap rounded-lg border border-ink/20 px-3 py-2 sm:px-4",
      callToAction: true,
    },
  ];
}

export default function HeaderAccountLinks({
  callToAction,
}: {
  callToAction?: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <>
      {headerLinksFor(pathname).map((link) =>
        link.callToAction ? (
          <Fragment key={link.label}>{callToAction}</Fragment>
        ) : (
          <Link key={link.label} href={link.href} className={link.className}>
            {link.label}
          </Link>
        ),
      )}
    </>
  );
}
