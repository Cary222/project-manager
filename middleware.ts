import { auth } from "@/lib/auth";
import { isRoot } from "@/shared/lib/permissions-client";
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

  // 跳过认证检查的路由
  if (isApiAuth || isRegisterApi || isKnowledgeApi || pathname.startsWith("/api/ai/geo")) {
    return NextResponse.next();
  }
  
  // AI Workspace 页面需要登录
  const isAiWorkspace = pathname.startsWith("/ai-workspace");
  if (isAiWorkspace && !isLoggedIn) {
    return NextResponse.redirect(loginUrl);
  }

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
