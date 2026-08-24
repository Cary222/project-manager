"use client";

import { createContext, useContext } from "react";

// 侧边栏折叠状态的初始值（SSR 阶段由根 layout 读取 cookie 后通过 Provider 注入）。
// 客户端组件无法在服务端渲染阶段直接调用 cookies()（Next.js 会抛 E1037），
// 因此用 context 把服务端读取的 cookie 值传给 AppShell，使 SSR 与客户端首次渲染一致，
// 避免半收缩模式下刷新页面出现"展开→收回"的闪烁。
export const SidebarCollapsedContext = createContext<boolean>(false);

export function useInitialSidebarCollapsed(): boolean {
  return useContext(SidebarCollapsedContext);
}
