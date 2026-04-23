"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { disconnectQboAction } from "@/app/qbo/actions";

export type QboConnectionState =
  | "disconnected"
  | "connected"
  | "reconnect_required";

export function ConnectQboButton({ state }: { state: QboConnectionState }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function goConnect() {
    router.push("/qbo/connect");
  }

  function onDisconnect() {
    startTransition(async () => {
      const result = await disconnectQboAction();
      if (result.ok) {
        toast.success("Disconnected QuickBooks.");
      } else {
        toast.error(`Could not disconnect: ${result.error}`);
      }
    });
  }

  if (state === "disconnected") {
    return <Button onClick={goConnect}>Connect QuickBooks</Button>;
  }

  if (state === "reconnect_required") {
    return (
      <Button variant="destructive" onClick={goConnect}>
        Reconnect QuickBooks
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        QBO connected
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onDisconnect}
        disabled={isPending}
      >
        {isPending ? "Disconnecting…" : "Disconnect"}
      </Button>
    </div>
  );
}
