"use client";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        router.refresh();
      }}
      className="rounded-lg border border-white/20 px-4 py-3 font-semibold"
    >
      Se déconnecter
    </button>
  );
}
