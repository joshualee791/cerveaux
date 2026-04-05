"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = e.currentTarget;
    const password = new FormData(form).get("password") as string;
    const res = await signIn("credentials", {
      password,
      redirect: false,
    });
    setPending(false);
    if (res?.error) {
      setError("Invalid password.");
      return;
    }
    if (res?.ok) {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-xl font-semibold text-neutral-900">Sign in</h1>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <label className="block text-sm text-neutral-800">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
            className="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-neutral-400 bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error ? (
        <p className="mt-4 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
