"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runMatchingAction } from "@/app/matching/run-matching-action";

export function RunMatchingButton() {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await runMatchingAction();
      if (result.ok) {
        toast.success(
          `Deterministic: ${result.deterministic.created} matched. ` +
            `LLM: ${result.llm.created} matched, ${result.llm.below_threshold} below threshold.`,
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={isPending}>
      {isPending ? "Matching…" : "Run matching"}
    </Button>
  );
}
