import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AiConversationRedirectPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/ai?c=${id}`);
}
