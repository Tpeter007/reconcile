import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { qboConnections } from "@/db/schema";
import { encryptToken } from "@/lib/crypto/tokens";
import { exchangeCodeForTokens } from "@/lib/qbo/oauth";

const STATE_COOKIE = "qbo_oauth_state";

function dashboardError(reason: string): never {
  redirect(`/dashboard?qbo_error=${encodeURIComponent(reason)}`);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const params = request.nextUrl.searchParams;
  const errorParam = params.get("error");
  if (errorParam) {
    console.error("[qbo] callback returned error param", {
      userId: user.id,
      error: errorParam,
    });
    dashboardError(errorParam);
  }

  const code = params.get("code");
  const state = params.get("state");
  const realmId = params.get("realmId");

  if (!code || !state || !realmId) {
    console.error("[qbo] callback missing required params", {
      userId: user.id,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasRealmId: Boolean(realmId),
    });
    dashboardError("missing_params");
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    console.error("[qbo] state mismatch on callback", { userId: user.id });
    dashboardError("state_mismatch");
  }

  try {
    const tokens = await exchangeCodeForTokens(code, realmId);
    // Encrypt immediately; only the encrypted values flow into the DB writes below.
    const encryptedAccessToken = encryptToken(tokens.access_token);
    const encryptedRefreshToken = encryptToken(tokens.refresh_token);
    await db
      .insert(qboConnections)
      .values({
        userId: user.id,
        realmId: tokens.realm_id,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        accessTokenExpiresAt: tokens.access_token_expires_at,
        refreshTokenExpiresAt: tokens.refresh_token_expires_at,
      })
      .onConflictDoUpdate({
        target: qboConnections.userId,
        set: {
          realmId: tokens.realm_id,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          accessTokenExpiresAt: tokens.access_token_expires_at,
          refreshTokenExpiresAt: tokens.refresh_token_expires_at,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error("[qbo] token exchange failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : "unknown",
    });
    dashboardError("token_exchange_failed");
  }

  redirect("/dashboard?qbo_connected=1");
}
