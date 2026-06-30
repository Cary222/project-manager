import Link from "next/link";
import type { AiProfileSummary } from "@/features/profile/lib/profile-actions";
import { IconSparkles } from "@/shared/ui/icons";

type Props = {
  aiProfile: AiProfileSummary;
  isOwnProfile: boolean;
  userName: string;
};

const SECTION_TONE: Record<ProfileKey, string> = {
  roles: "border-violet-200 bg-violet-50 text-violet-700",
  expertise: "border-brand-200 bg-brand-50 text-brand-700",
  interests: "border-amber-200 bg-amber-50 text-amber-700",
  projects: "border-emerald-200 bg-emerald-50 text-emerald-700",
  recentTopics: "border-ink-200 bg-ink-50 text-ink-700",
} as const;

const SECTION_LABEL: Record<ProfileKey, string> = {
  roles: "角色",
  expertise: "专长",
  interests: "兴趣领域",
  projects: "参与项目",
  recentTopics: "最近话题",
} as const;

type ProfileKey = "roles" | "expertise" | "interests" | "projects" | "recentTopics";

function isEmptyProfile(p: NonNullable<AiProfileSummary["profile"]>): boolean {
  const fields: ProfileKey[] = ["roles", "expertise", "interests", "projects", "recentTopics"];
  return fields.every((key) => {
    const val = p[key];
    return !Array.isArray(val) || val.length === 0;
  });
}

function formatUpdatedAt(date: Date | null): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function ProfileAiSummary({ aiProfile, isOwnProfile, userName }: Props) {
  // Empty / not-yet-generated state
  if (!aiProfile.hasProfile || !aiProfile.profile || isEmptyProfile(aiProfile.profile)) {
    return (
      <section className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
            <IconSparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-violet-700">AI 画像</h3>
              <span className="rounded bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-600">
                待生成
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-500">
              {isOwnProfile
                ? "与 AI 对话后，AI 会自动从对话摘要中提炼您的角色、专长、兴趣等画像。"
                : `${userName} 还没有生成 AI 画像。`}
            </p>
            {isOwnProfile && (
              <Link
                href="/ai"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:outline-none"
              >
                与 AI 聊天生成画像
              </Link>
            )}
          </div>
        </div>
      </section>
    );
  }

  // Populated state
  const p = aiProfile.profile;
  const sections: ProfileKey[] = [
    "roles",
    "expertise",
    "interests",
    "projects",
    "recentTopics",
  ];

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-ink-700">AI 画像</h3>
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            已生成
          </span>
          <span className="text-[10px] text-ink-400">
            基于 {aiProfile.sourceSummaryCount} 段对话摘要
          </span>
        </div>
        <span className="text-[10px] text-ink-400">
          更新于 {formatUpdatedAt(aiProfile.updatedAt)}
        </span>
      </div>

      <div className="space-y-3">
        {sections.map((key) => {
          const list = p[key];
          if (!Array.isArray(list) || list.length === 0) return null;
          return (
            <div key={key}>
              <p className="mb-1.5 text-xs font-medium text-ink-500">
                {SECTION_LABEL[key]}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((item, idx) => (
                  <span
                    key={`${key}-${idx}`}
                    className={`rounded-md border px-2 py-0.5 text-xs ${SECTION_TONE[key]}`}
                  >
                    {String(item)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {isOwnProfile && (
        <div className="mt-4 border-t border-ink-100 pt-3">
          <Link
            href="/ai"
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
          >
            <IconSparkles className="h-4 w-4" />
            与 AI 对话更新画像
          </Link>
        </div>
      )}
    </section>
  );
}
