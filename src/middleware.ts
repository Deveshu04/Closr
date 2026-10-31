import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "closr_console";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

function isLocal(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  // Next fills X-Forwarded-For with the socket address when absent; a tunnel appends the real client last,
  // so only the final hop is trustworthy. X-Forwarded-Host is client-supplied and deliberately ignored.
  const lastHop = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "";
  return LOCAL_HOSTS.has(host) && LOOPBACK.test(lastHop);
}

function isCrossSite(request: NextRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  return !!origin && new URL(origin).host !== request.headers.get("host");
}

// The tunnel that lets Bolna reach our tools also exposes the console, which shows the caller's
// real number and can approve refunds. Local use stays frictionless; remote use needs CONSOLE_KEY.
export function middleware(request: NextRequest) {
  if (isCrossSite(request)) return new NextResponse("Cross-site request refused", { status: 403 });
  if (isLocal(request)) return NextResponse.next();
  // A hosted demo for judges can drop the key; the console then holds only seeded demo data.
  if (process.env.PUBLIC_CONSOLE === "true") return NextResponse.next();

  const key = process.env.CONSOLE_KEY?.trim();
  if (!key) return new NextResponse("Console is only available locally.", { status: 403 });

  if (sameSecret(request.cookies.get(COOKIE)?.value ?? "", key)) return NextResponse.next();

  const presented = request.nextUrl.searchParams.get("key")?.trim();
  if (presented && sameSecret(presented, key)) {
    // Behind a proxy nextUrl carries the server's bind address, so rebuild the public URL from the request.
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
    const clean = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `${proto}://${request.headers.get("host")}`);
    clean.searchParams.delete("key");
    const response = NextResponse.redirect(clean);
    // Lax, so the cookie survives the redirect when the link is opened from another site.
    response.cookies.set(COOKIE, key, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 12 });
    return response;
  }
  return new NextResponse("Unauthorized. Open this page with ?key=<CONSOLE_KEY> once.", { status: 401 });
}

export const config = {
  matcher: ["/", "/customer", "/diagnostics", "/api/state", "/api/call", "/api/calls", "/api/calls/:path*", "/api/chat/:path*", "/api/autonomy", "/api/lessons", "/api/lessons/:path*", "/api/metrics", "/api/followups/:path*", "/api/reset", "/api/approvals/:path*"],
};
