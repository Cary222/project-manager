import { auth } from "@/lib/auth";
import { isRoot } from "@/shared/lib/permissions";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === "/login";
  const isApiAuth = pathname.startsWith("/api/auth");
  const isRegisterApi = pathname === "/api/register";
  const isKnowledgeApi = pathname.startsWith("/api/knowledge");
  const isAdmin = pathname.startsWith("/admin");
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const homeUrl = req.nextUrl.clone();
  homeUrl.pathname = "/";
  homeUrl.search = "";

  if (isApiAuth || isRegisterApi || isKnowledgeApi) return NextResponse.next();

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(homeUrl);
  }

  if (isAdmin && !isRoot(req.auth?.user?.role)) {
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
