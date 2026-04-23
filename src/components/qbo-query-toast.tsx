"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "QBO connect failed: state mismatch.",
  missing_params: "QBO connect failed: missing parameters from Intuit.",
  token_exchange_failed: "QBO connect failed: token exchange error.",
  access_denied: "QBO connect canceled.",
};

export function QboQueryToast() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const err = params.get("qbo_error");
    const connected = params.get("qbo_connected");
    if (!err && !connected) return;

    if (err) {
      toast.error(ERROR_MESSAGES[err] ?? `QBO error: ${err}`);
    } else if (connected) {
      toast.success("QuickBooks connected.");
    }

    const next = new URLSearchParams(params.toString());
    next.delete("qbo_error");
    next.delete("qbo_connected");
    const qs = next.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard");
  }, [params, router]);

  return null;
}
