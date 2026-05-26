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
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
      <form
        onSubmit={mode === "login" ? onSubmit : onRegister}
        className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-zinc-900">项目管理</h1>
        <p className="text-sm text-zinc-500">
          未登录时先登录或注册。注册账号固定为 user。
        </p>
        <div className="grid grid-cols-2 rounded-lg bg-zinc-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-md px-3 py-2 ${
              mode === "login" ? "bg-white shadow-sm" : "text-zinc-500"
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
            className={`rounded-md px-3 py-2 ${
              mode === "register" ? "bg-white shadow-sm" : "text-zinc-500"
            }`}
          >
            注册
          </button>
        </div>
        {mode === "register" ? (
          <label className="block space-y-1 text-sm">
            <span>昵称</span>
            <input
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span>邮箱</span>
          <input
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>密码</span>
          <input
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {loading ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}
        </button>
      </form>
    </div>
  );
}
