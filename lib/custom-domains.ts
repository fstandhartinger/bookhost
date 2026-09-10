import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";
import {
  DEFENSIVE_HOSTS,
  LEGACY_HOSTS,
  TENANT_DOMAINS,
  NEW_TENANT_DOMAIN,
  PUBLIC_BASE_URL,
} from "./config";
export function validDomain(host: unknown): host is string {
  if (
    typeof host !== "string" ||
    host.length > 253 ||
    isIP(host) ||
    !host.includes(".")
  )
    return false;
  const labels = host.split(".");
  if (
    !labels.every(
      (label) =>
        label.length <= 63 &&
        !label.startsWith("xn--") &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) ||
    !/^[a-z]{2,63}$/.test(labels.at(-1)!)
  )
    return false;
  const reserved = [
    "bookhost.co",
    "bookhost.cloud",
    "bookhost.online",
    "bookhost.site",
    "wissen.app.mintapis.com",
    ...DEFENSIVE_HOSTS,
    ...LEGACY_HOSTS,
    ...TENANT_DOMAINS,
    NEW_TENANT_DOMAIN,
    new URL(PUBLIC_BASE_URL).hostname,
  ];
  return !reserved.some((base) => host === base || host.endsWith(`.${base}`));
}
export async function verifyDomain(
  host: string,
  token: string,
  tenantHost: string,
): Promise<{ verified: boolean; error?: string }> {
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    const [txt, cname, a, aaaa] = await Promise.all([
      resolver.resolveTxt(`_bookhost-verify.${host}`).catch(() => []),
      resolver.resolveCname(host).catch(() => []),
      resolver.resolve4(host).catch(() => []),
      resolver.resolve6(host).catch(() => []),
    ]);
    const expected = Buffer.from(token);
    if (
      !txt.some((chunks) => {
        const value = Buffer.from(chunks.join(""));
        return (
          value.length === expected.length && timingSafeEqual(value, expected)
        );
      })
    )
      return {
        verified: false,
        error:
          "TXT verification token not found. Check the exact value and allow DNS time to update.",
      };
    const addresses = [
      process.env.CUSTOM_DOMAIN_IPV4,
      process.env.CUSTOM_DOMAIN_IPV6,
    ].filter((v): v is string => !!v && !!isIP(v));
    const normalize = (value: string) =>
      isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value;
    const pointsHere =
      cname.some(
        (value) =>
          value.toLowerCase().replace(/\.$/, "") === tenantHost.toLowerCase(),
      ) ||
      [...a, ...aaaa].some((value) =>
        addresses.some((ip) => normalize(ip) === normalize(value)),
      );
    return pointsHere
      ? { verified: true }
      : {
          verified: false,
          error:
            "Point the CNAME to your workspace address, or use the displayed A record, then try again.",
        };
  };
  try {
    return await Promise.race([
      work(),
      new Promise<{ verified: false; error: string }>((resolve) => {
        timer = setTimeout(() => {
          resolver.cancel();
          resolve({
            verified: false,
            error: "DNS lookup timed out. Please retry.",
          });
        }, 4000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
