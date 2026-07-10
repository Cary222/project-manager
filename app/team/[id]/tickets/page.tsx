import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfileAction } from "@/features/profile/lib/profile-actions";
import { prisma } from "@/shared/db/client";
import { UserTicketList } from "@/features/team/ui/UserTicketList";

type Props = { params: Promise<{ id: string }> };

export default async function TeamMemberTicketsPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await getUserProfileAction(id).catch(() => null);
  if (!profile) {
    notFound();
  }

  const isOwnProfile = id === session.user.id;

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref={`/team/${id}`}
          backLabel="返回个人主页"
          title={`${profile.name || profile.email} 的单子`}
          subtitle={isOwnProfile ? "我的单子" : "参与的单子"}
        />
      }
    >
      <div className="mx-auto max-w-5xl space-y-6 px-4 sm:px-6 pm-fade-in">
        <UserTicketList userId={id} />
      </div>
    </AppShell>
  );
}
