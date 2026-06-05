"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireRoot, requireSession } from "@/lib/permissions";

function getSystemSettingModel() {
  return (prisma as typeof prisma & {
    systemSetting?: {
      findFirst: (...args: unknown[]) => Promise<unknown>;
      update: (...args: unknown[]) => Promise<unknown>;
      create: (...args: unknown[]) => Promise<unknown>;
    };
  }).systemSetting;
}

/** 获取当前用户资料（用于设置页展示） */
export async function getProfileAction() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      passwordHash: true,
    },
  });
  if (!user) throw new Error("用户不存在");
  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    hasPassword: !!user.passwordHash,
  };
}

export type SystemSettingSummary = {
  id: string;
  siteName: string;
  siteDescription: string;
  logoUrl: string;
  welcomeMessage: string;
  updatedAt: string;
};

/** 获取系统设置，仅 ROOT 可调用 */
export async function getSystemSettingsAction(): Promise<SystemSettingSummary | null> {
  await requireRoot();
  const systemSetting = getSystemSettingModel();
  if (!systemSetting) return null;

  const settings = (await systemSetting.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      siteName: true,
      siteDescription: true,
      logoUrl: true,
      welcomeMessage: true,
      updatedAt: true,
    },
  })) as {
    id: string;
    siteName: string;
    siteDescription: string | null;
    logoUrl: string | null;
    welcomeMessage: string | null;
    updatedAt: Date;
  } | null;

  if (!settings) return null;

  return {
    ...settings,
    siteDescription: settings.siteDescription ?? "",
    logoUrl: settings.logoUrl ?? "",
    welcomeMessage: settings.welcomeMessage ?? "",
    updatedAt: settings.updatedAt.toISOString(),
  };
}

/** 更新个人资料（仅 name） */
export async function updateProfileAction(
  name: string
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireSession();
  const trimmed = name.trim();

  if (!trimmed) return { error: "姓名不能为空" };
  if (trimmed.length > 40) return { error: "姓名过长（最多 40 字符）" };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: trimmed },
  });

  revalidatePath("/admin/settings");
  return { success: true };
}

/** 修改密码 */
export async function changePasswordAction(
  oldPassword: string,
  newPassword: string,
  confirmPassword: string
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireSession();

  if (newPassword !== confirmPassword) {
    return { error: "两次输入的新密码不一致" };
  }
  if (newPassword.length < 6) {
    return { error: "新密码至少 6 个字符" };
  }
  if (newPassword.length > 72) {
    return { error: "新密码过长（最多 72 字符）" };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  if (user?.passwordHash) {
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) return { error: "原密码错误" };
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: hash },
  });

  revalidatePath("/admin/settings");
  return { success: true };
}

/** 更新系统设置，仅 ROOT 可调用 */
export async function updateSystemSettingsAction(input: {
  siteName: string;
  siteDescription: string;
  logoUrl: string;
  welcomeMessage: string;
}): Promise<{ success?: boolean; error?: string }> {
  const session = await requireRoot();
  const systemSetting = getSystemSettingModel();
  if (!systemSetting) {
    return { error: "系统设置模型尚未初始化，请先执行 npx prisma db push" };
  }

  const siteName = input.siteName.trim();
  const siteDescription = input.siteDescription.trim();
  const logoUrl = input.logoUrl.trim();
  const welcomeMessage = input.welcomeMessage.trim();

  if (!siteName) return { error: "站点名称不能为空" };
  if (siteName.length > 60) return { error: "站点名称过长（最多 60 字符）" };

  const existing = (await systemSetting.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })) as { id: string } | null;

  if (existing) {
    await systemSetting.update({
      where: { id: existing.id },
      data: {
        siteName,
        siteDescription: siteDescription || null,
        logoUrl: logoUrl || null,
        welcomeMessage: welcomeMessage || null,
        updatedById: session.user.id,
      },
    });
  } else {
    await systemSetting.create({
      data: {
        siteName,
        siteDescription: siteDescription || null,
        logoUrl: logoUrl || null,
        welcomeMessage: welcomeMessage || null,
        updatedById: session.user.id,
      },
    });
  }

  revalidatePath("/admin/settings");
  return { success: true };
}
