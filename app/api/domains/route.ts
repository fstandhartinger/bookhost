import { domainRequest } from "@/lib/domain-api";
export const runtime = "nodejs";
export const POST = (request: Request) => domainRequest(request, "add");
export const DELETE = (request: Request) => domainRequest(request, "remove");
