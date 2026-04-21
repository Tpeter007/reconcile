"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent" }
  | { state: "error"; message: string };

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    setStatus({ state: "sending" });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setStatus({ state: "error", message: error.message });
      return;
    }
    setStatus({ state: "sent" });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          We&apos;ll email you a magic link. No password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            type="email"
            name="email"
            placeholder="you@example.com"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status.state === "sending" || status.state === "sent"}
          />
          <Button type="submit" disabled={status.state === "sending"}>
            {status.state === "sending" ? "Sending…" : "Send magic link"}
          </Button>
          {status.state === "sent" ? (
            <p className="text-sm text-muted-foreground">
              Check <span className="font-medium">{email}</span> for your sign-in
              link.
            </p>
          ) : null}
          {status.state === "error" ? (
            <p className="text-sm text-destructive">{status.message}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
