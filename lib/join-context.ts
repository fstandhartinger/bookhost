import { cookies } from "next/headers";
import { baseUrl } from "./config";
export const JOIN_COOKIE = "wissen-join";
export const ACTIVE_TEAM_COOKIE = "wissen-team";
export const contextCookieOptions = () => ({
  httpOnly: true,
  secure: baseUrl().startsWith("https:"),
  sameSite: "lax" as const,
  path: "/",
});
export async function loginDestination() {
  return (await cookies()).get(JOIN_COOKIE)?.value ? "/join" : "/app";
}
