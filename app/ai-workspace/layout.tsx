// AI Workspace 不在 layout 层做认证检查
// 认证由前端在 API 调用时处理（所有 API 都有 requireSession）
export default async function AiWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen w-screen overflow-hidden">
      {children}
    </div>
  );
}
