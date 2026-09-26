import { guides } from "@/lib/guides";
import { getPosts } from "@/app/blog/posts";
import { PLAN, PUBLIC_BASE_URL } from "@/lib/config";

export function siteLlmsTxt() {
  const url = (path: string) => `${PUBLIC_BASE_URL}${path}`;
  const body = `# BookHost

> Managed BookStack hosting for teams. A private BookStack wiki with hosting, maintenance, security updates, daily backups (seven-day retention) and restore help, on Hetzner infrastructure in Germany or Finland. One plan: €${PLAN.price}/month plus applicable VAT, ${PLAN.trialDays} days free without a card. Optional betas: reviewed document intake and "Ask your wiki" answers with named source pages (non-personal content only while in beta).

BookHost is an independent hosting service operated by productivity-boost.com Betriebs UG (haftungsbeschränkt) & Co. KG, Passau, Germany. BookStack is MIT-licensed open-source software; BookHost is not affiliated with its maintainers.

## Product
- [Home](${url("/")}): what BookHost includes, how sign-up works, FAQ
- [Pricing](${url("/pricing")}): the Team plan, limits and trial terms
- [Move your existing BookStack](${url("/migrate")}): what we need, what we migrate, how cutover works
- [Backups, reliability and current limits](${url("/reliability")}): what we promise and what we do not
- [Live demo](https://demo.bookhost.co): a read-only BookStack workspace

## Guides
${guides.map((g) => `- [${g.title}](${url(`/${g.slug}`)}): ${g.description}`).join("\n")}

## Blog
${getPosts()
  .map((post) => `- [${post.title}](${url(`/blog/${post.slug}`)})`)
  .join("\n")}

## Legal (German, binding)
- [Impressum](${url("/legal/impressum")})
- [Datenschutzerklärung](${url("/legal/datenschutz")})
- [AGB](${url("/legal/agb")})
- [AVV (data processing agreement)](${url("/legal/avv")})

Contact: info@productivity-boost.com
`;
  return body;
}
