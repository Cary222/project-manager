import { AppShellWithSuspense } from "@/shared/ui/AppShell";
import { SimplePageHeader } from "@/shared/ui/headers";
import AiChatPage from "@/features/ai/ui/AiChatPage";

export default function Page() {
  return (
    <AppShellWithSuspense
      header={
        <SimplePageHeader
          title="小星 · AI 助手"
          subtitle="恒星研内部项目管理系统的智能助手 · 开发者：cary"
        />
      }
    >
      <AiChatPage />
    </AppShellWithSuspense>
  );
}