import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "closr_console";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The tunnel that lets Bolna reach our tools also exposes the console, which shows the caller's
// real number and can approve refunds. Local use stays frictionless; remote use needs CONSOLE_KEY.
export function middleware(request: NextRequest) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (LOCAL_HOSTS.has(host)) return NextResponse.next();

  const key = process.env.CONSOLE_KEY;
  if (!key) return new NextResponse("Console is only available locally.", { status: 403 });

  if (sameSecret(request.cookies.get(COOKIE)?.value ?? "", key)) return NextResponse.next();

  const presented = request.nextUrl.searchParams.get("key");
  if (presented && sameSecret(presented, key)) {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("key");
    const response = NextResponse.redirect(clean);
    response.cookies.set(COOKIE, key, { httpOnly: true, sameSite: "strict", secure: true, maxAge: 60 * 60 * 12 });
    return response;
  }
  return new NextResponse("Unauthorized", { status: 401 });
}

export const config = {
  matcher: ["/", "/api/state", "/api/call", "/api/reset", "/api/approvals/:path*"],
};
