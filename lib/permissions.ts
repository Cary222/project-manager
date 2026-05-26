import { UserRole } from "@prisma/client";
import { auth } from "@/lib/auth";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export async function requireRoot() {
  const session = await requireSession();
  if (session.user.role !== UserRole.ROOT) {
    throw new Error("FORBIDDEN");
  }
  return session;
}
