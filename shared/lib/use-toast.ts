"use client";

import { toast } from "sonner";

/**
 * ProjectHub 通知 hook —— 让 client 组件无需重复 import sonner。
 *
 * AppShell 已在全局挂载 <Toaster position="top-right" richColors />，
 * 任何调用点只需 useToast() 即可弹出。
 *
 * 用法：
 *   const { toast } = useToast();
 *   toast.success("保存成功");
 *   toast.error(`保存失败: ${msg}`);
 *   toast.info("功能即将上线");
 */
export function useToast(): { toast: typeof toast } {
  return { toast };
}

export { toast };
