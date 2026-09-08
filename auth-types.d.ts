import "next-auth";
declare module "next-auth" {
  interface Session {
    auth_time?: number;
  }
}
