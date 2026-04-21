"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.refresh();
      router.push("/login");
    });
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={isPending}>
      {isPending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
