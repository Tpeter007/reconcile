"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { qboConnections, qboEntries } from "@/db/schema";
import { TokenDecryptError } from "@/lib/crypto/tokens";
import { syncQboEntries } from "@/lib/qbo/sync";
import {
  QboNotConnectedError,
  QboReconnectRequiredError,
} from "@/lib/qbo/errors";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

export type SyncQboActionResult =
  | {
      ok: true;
      created: number;
      updated: number;
      by_type: Record<string, number>;
      failures: { entity: string; error: string }[];
    }
  | { ok: false; error: string };

export async function syncQboEntriesAction(): Promise<SyncQboActionResult> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: "not_authenticated" };
  }

  try {
    const result = await syncQboEntries(userId);
    revalidatePath("/dashboard");
    return {
      ok: true,
      created: result.created,
      updated: result.updated,
      by_type: result.by_type,
      failures: result.failures,
    };
  } catch (err) {
    if (err instanceof QboNotConnectedError) {
      return { ok: false, error: "not_connected" };
    }
    if (err instanceof QboReconnectRequiredError) {
      return { ok: false, error: "reconnect_required" };
    }
    if (err instanceof TokenDecryptError) {
      console.error("[qbo] token decrypt failure in sync", {
        userId,
        provider: "qbo",
        column: "access_token",
      });
      return {
        ok: false,
        error: "Connection data couldn't be decrypted. Please reconnect.",
      };
    }
    console.error("[qbo] syncQboEntriesAction failed", {
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, error: "sync_failed" };
  }
}

export type DisconnectQboActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function disconnectQboAction(): Promise<DisconnectQboActionResult> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { ok: false, error: "not_authenticated" };
  }

  try {
    await db.delete(qboEntries).where(eq(qboEntries.userId, userId));
    await db.delete(qboConnections).where(eq(qboConnections.userId, userId));
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    console.error("[qbo] disconnectQboAction failed", {
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, error: "disconnect_failed" };
  }
}
