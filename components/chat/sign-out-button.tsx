"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-left text-sm text-neutral-800 hover:bg-neutral-100"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      Sign out
    </button>
  );
}
