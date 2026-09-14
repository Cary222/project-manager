/**
 * Shared Time Window & Calendar Utilities — 双链路共享的业务自然时间窗口。
 *
 * 统一采用 Asia/Shanghai 作为业务日历基准，解决跨时区与 23:59:59.999 毫秒边界问题。
 */

export {
 WORK_TIMEZONE,
 type TimeWindow,
 resolveTimeWindow,
 getMonthRangeByOffset,
} from "@/features/ai/agents/work/tools/time-window";
