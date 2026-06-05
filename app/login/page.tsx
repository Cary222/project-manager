"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);
    if (result?.error) {
      setError("登录失败，请检查账号密码");
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      setLoading(false);
      setError(res.status === 409 ? "邮箱已注册" : "注册失败，请检查信息");
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);
    if (result?.error) {
      setMode("login");
      setError("注册成功，请重新登录");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-ink-100">
      {/* 左侧品牌区 */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 to-brand-800 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </div>
          <span className="text-lg font-semibold">ProjectHub</span>
        </div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">
            专注交付，
            <br />
            用知识驱动成长
          </h2>
          <p className="mt-4 max-w-md text-sm text-brand-100">
            项目树、任务单、状态跟踪与 Git 提交自动关联，
            让团队协作更高效，让每一行代码都有迹可循。
          </p>
        </div>
        <p className="text-xs text-brand-200">© 2024 ProjectHub · 项目管理平台</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
      </div>

      {/* 右侧表单区 */}
      <div className="flex flex-1 items-center justify-center p-6">
        <form
          onSubmit={mode === "login" ? onSubmit : onRegister}
          className="w-full max-w-sm space-y-5 rounded-2xl border border-ink-200 bg-white p-8 shadow-base"
        >
          <div className="lg:hidden">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              </div>
              <span className="text-base font-semibold">ProjectHub</span>
            </div>
          </div>

          <div>
            <h1 className="text-xl font-semibold text-ink-900">
              {mode === "login" ? "欢迎回来" : "创建账号"}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {mode === "login"
                ? "登录以继续使用项目管理平台"
                : "注册账号默认为普通成员（USER）"}
            </p>
          </div>

          <div className="grid grid-cols-2 rounded-lg bg-ink-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-md px-3 py-2 font-medium transition ${
                mode === "login"
                  ? "bg-white text-ink-900 shadow-soft"
                  : "text-ink-500"
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setEmail("");
                setPassword("");
                setError("");
              }}
              className={`rounded-md px-3 py-2 font-medium transition ${
                mode === "register"
                  ? "bg-white text-ink-900 shadow-soft"
                  : "text-ink-500"
              }`}
            >
              注册
            </button>
          </div>

          {mode === "register" ? (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink-700">昵称</span>
              <input
                className="w-full rounded-lg border border-ink-200 px-3 py-2.5 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          ) : null}
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink-700">邮箱</span>
            <input
              className="w-full rounded-lg border border-ink-200 px-3 py-2.5 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink-700">密码</span>
            <input
              className="w-full rounded-lg border border-ink-200 px-3 py-2.5 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
