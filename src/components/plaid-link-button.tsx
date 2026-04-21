"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "@/components/ui/button";
import { createLinkToken, exchangePublicToken } from "@/app/plaid/actions";

export function PlaidLinkButton() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createLinkToken()
      .then(({ linkToken }) => setLinkToken(linkToken))
      .catch((e) => setError(e instanceof Error ? e.message : "Unknown error"));
  }, []);

  const onSuccess = useCallback((publicToken: string) => {
    startTransition(async () => {
      try {
        await exchangePublicToken(publicToken);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Exchange failed");
      }
    });
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() => open()}
        disabled={!ready || !linkToken || isPending}
      >
        {isPending
          ? "Syncing transactions…"
          : linkToken
            ? "Connect a bank"
            : "Loading…"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
