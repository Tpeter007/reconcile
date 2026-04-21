"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadLedgerCsv } from "@/app/ledger/upload-action";

export function LedgerUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function onClick() {
    inputRef.current?.click();
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      const result = await uploadLedgerCsv(formData);
      if (result.ok) {
        const skipped = result.errors.length;
        toast.success(
          skipped > 0
            ? `Uploaded ${result.inserted} entries, ${skipped} rows skipped`
            : `Uploaded ${result.inserted} entries`,
        );
      } else {
        toast.error(result.error);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={onChange}
      />
      <Button variant="outline" onClick={onClick} disabled={isPending}>
        {isPending ? "Uploading…" : "Upload ledger CSV"}
      </Button>
    </>
  );
}
