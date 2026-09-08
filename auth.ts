import { randomUUID } from "node:crypto";
import { sessionToken } from "./lib/session";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authorizePassword } from "./lib/password";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { createTransport } from "nodemailer";
import { adapter } from "./lib/auth-adapter";
import { smtpReady, baseUrl } from "./lib/config";
import { digest, rateLimit } from "./lib/security";
export const sessionCookie = () => ({
  name: baseUrl().startsWith("https:")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token",
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: baseUrl().startsWith("https:"),
  },
});
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login", verifyRequest: "/login?sent=1", error: "/login" },
  cookies: { sessionToken: sessionCookie() },
  providers: [
    Credentials({
      credentials: { email: { type: "email" }, password: { type: "password" } },
      authorize: authorizePassword,
    }),
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            allowDangerousEmailAccountLinking: true,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
    ...(smtpReady() || process.env.NODE_ENV !== "production"
      ? [
          Nodemailer({
            server: {
              host: process.env.SMTP_HOST,
              port: Number(process.env.SMTP_PORT || 587),
              secure: process.env.SMTP_PORT === "465",
              auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined,
            },
            from: process.env.SMTP_FROM || "Wissen <noreply@localhost>",
            maxAge: 900,
            async sendVerificationRequest({ identifier, url, provider }) {
              if (
                !(await rateLimit(
                  "email:" + digest(identifier.toLowerCase()),
                  5,
                ))
              )
                throw new Error("Please try again later");
              if (!smtpReady()) {
                if (process.env.NODE_ENV !== "production")
                  console.info("Development sign-in link:", url);
                return;
              }
              const transport = createTransport(provider.server);
              await transport.sendMail({
                to: identifier,
                from: provider.from,
                subject: "Sign in to Wissen",
                text: `Sign in to Wissen: ${url}\nThis link expires in 15 minutes. If you did not request it, ignore this email.`,
              });
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      return account?.provider !== "google" || profile?.email_verified === true;
    },
    async jwt({ token, user, account }) {
      if (user) token.auth_time = Math.floor(Date.now() / 1000);
      if (user && account?.provider === "credentials") {
        return sessionToken({
          ...token,
          sub: user.id,
          session_version: (user as typeof user & { session_version: number })
            .session_version,
        });
      }
      return sessionToken(token, user?.id);
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      session.auth_time =
        typeof token.auth_time === "number" ? token.auth_time : undefined;
      return session;
    },
  },
  logger: {
    error(error) {
      const name = /^[A-Za-z]{1,80}$/.test(error.name)
        ? error.name
        : "AuthError";
      console.error("Authentication request failed", {
        name,
        correlationId: randomUUID(),
      });
    },
    warn(code) {
      console.warn("Authentication warning:", code);
    },
  },
});
