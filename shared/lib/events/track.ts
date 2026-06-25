import { EVENT_VERSION } from "./ACTION";
import type { RawEvent } from "./types";

/**
 * 前端事件 SDK（普通请求）
 *
 * 原则：
 * - 静默失败：不阻断主业务
 * - 不阻塞渲染：用 keepalive 允许请求在页面跳转后继续
 */
export async function trackEvent(event: Omit<RawEvent, "eventVersion">) {
  const fullEvent: RawEvent = {
    eventVersion: EVENT_VERSION,
    ...event,
  };

  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fullEvent),
    keepalive: true,
  }).catch(() => {});
}

/**
 * sendBeacon 发送（页面卸载时使用）
 *
 * ⚠️ sendBeacon 返回 boolean（true/false），false 不是 nullish，
 * 不能用 ?? 触发 fallback，必须用 if 显式判断。
 */
export function trackEventBeacon(event: Omit<RawEvent, "eventVersion">) {
  const fullEvent: RawEvent = {
    eventVersion: EVENT_VERSION,
    ...event,
  };

  const payload = JSON.stringify(fullEvent);
  const blob = new Blob([payload], { type: "application/json" });

  // sendBeacon 失败（false）时 fallback 到 keepalive fetch
  if (!navigator.sendBeacon?.("/api/events", blob)) {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}