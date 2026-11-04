import { type NextRequest, NextResponse } from "next/server";

const SIGN_IN_PATH = "/portal/sign-in";

// An optimistic check for a session cookie only; the backend validates the session on every request.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === SIGN_IN_PATH) {
    return NextResponse.next();
  }
  if (!request.cookies.has("p2p_session")) {
    return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/portal/:path*",
};
