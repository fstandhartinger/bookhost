import { domainRequest } from "@/lib/domain-api";
export const runtime = "nodejs";
export const POST = (request: Request) => domainRequest(request, "check");
