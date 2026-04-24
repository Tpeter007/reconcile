import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { qboConnections } from "@/db/schema";
import {
  decryptToken,
  encryptToken,
  TokenDecryptError,
} from "@/lib/crypto/tokens";
import { QboNotConnectedError, QboReconnectRequiredError } from "./errors";
import { refreshTokens } from "./oauth";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const QBO_API_BASE_SANDBOX = "https://sandbox-quickbooks.api.intuit.com";
const QBO_API_BASE_PRODUCTION = "https://quickbooks.api.intuit.com";

function apiBase(): string {
  return (process.env.QBO_ENVIRONMENT ?? "sandbox") === "production"
    ? QBO_API_BASE_PRODUCTION
    : QBO_API_BASE_SANDBOX;
}

export type QboQueryResponse = {
  QueryResponse?: Record<string, unknown> & {
    maxResults?: number;
    startPosition?: number;
    totalCount?: number;
  };
  time?: string;
};

export type AuthorizedQboClient = {
  realmId: string;
  query: (sql: string) => Promise<QboQueryResponse>;
};

async function markConnectionBroken(userId: string): Promise<void> {
  try {
    await db
      .update(qboConnections)
      .set({
        accessTokenExpiresAt: sql`NOW() - INTERVAL '1 second'`,
        refreshTokenExpiresAt: sql`NOW() - INTERVAL '1 second'`,
        updatedAt: new Date(),
      })
      .where(eq(qboConnections.userId, userId));
  } catch (markErr) {
    console.error(
      "[qbo] failed to mark connection broken (best-effort)",
      { userId, error: markErr instanceof Error ? markErr.message : "unknown" },
    );
  }
}

async function ensureFreshAccessToken(userId: string): Promise<{
  accessToken: string;
  realmId: string;
}> {
  const [row] = await db
    .select()
    .from(qboConnections)
    .where(eq(qboConnections.userId, userId))
    .limit(1);

  if (!row) {
    throw new QboNotConnectedError();
  }

  if (row.refreshTokenExpiresAt.getTime() <= Date.now()) {
    throw new QboReconnectRequiredError(
      "Refresh token expired; user must reauthorize.",
    );
  }

  const accessExpiresInMs = row.accessTokenExpiresAt.getTime() - Date.now();
  if (accessExpiresInMs > FIVE_MINUTES_MS) {
    // Fresh-enough path: decrypt the stored access token and hand plaintext to caller.
    // If decrypt fails here, let TokenDecryptError propagate to the server action.
    const accessToken = decryptToken(row.accessToken);
    return { accessToken, realmId: row.realmId };
  }

  // ----- Refresh path -----
  // Step 6 sequencing (preserved, extended for encryption):
  //   (1) decrypt stored refresh_token to plaintext
  //   (2) call Intuit with plaintext refresh_token
  //   (3) encrypt new access_token and new refresh_token
  //   (4) UPDATE qbo_connections with encrypted values + new expiries
  //   (5) return plaintext access_token to caller AFTER the UPDATE succeeds
  // If the DB write fails we do NOT retry the refresh (the old refresh token
  // is dead). Instead we mark the connection broken and surface a reconnect.

  let plaintextRefreshToken: string;
  try {
    plaintextRefreshToken = decryptToken(row.refreshToken);
  } catch (err) {
    if (err instanceof TokenDecryptError) {
      console.error("[qbo] qbo refresh_token decrypt failure", { userId });
      await markConnectionBroken(userId);
      throw new QboReconnectRequiredError();
    }
    throw err;
  }

  let newTokens;
  try {
    newTokens = await refreshTokens(plaintextRefreshToken);
  } catch (err) {
    console.error("[qbo] token refresh failed", {
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
    await markConnectionBroken(userId);
    throw new QboReconnectRequiredError();
  }

  const encryptedAccessToken = encryptToken(newTokens.access_token);
  const encryptedRefreshToken = encryptToken(newTokens.refresh_token);

  try {
    await db
      .update(qboConnections)
      .set({
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        accessTokenExpiresAt: newTokens.access_token_expires_at,
        refreshTokenExpiresAt: newTokens.refresh_token_expires_at,
        updatedAt: new Date(),
      })
      .where(eq(qboConnections.userId, userId));
  } catch (dbErr) {
    console.error("[qbo] failed to persist refreshed tokens", {
      userId,
      error: dbErr instanceof Error ? dbErr.message : "unknown",
    });
    await markConnectionBroken(userId);
    throw new QboReconnectRequiredError();
  }

  return { accessToken: newTokens.access_token, realmId: row.realmId };
}

export async function getAuthorizedQboClient(
  userId: string,
): Promise<AuthorizedQboClient> {
  const { accessToken, realmId } = await ensureFreshAccessToken(userId);

  return {
    realmId,
    async query(qboSql: string): Promise<QboQueryResponse> {
      const url =
        `${apiBase()}/v3/company/${encodeURIComponent(realmId)}/query` +
        `?query=${encodeURIComponent(qboSql)}&minorversion=70`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (res.status === 401) {
        throw new QboReconnectRequiredError(
          "QBO returned 401 with a freshly-validated access token.",
        );
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `[qbo] query failed: HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 500)}`,
        );
      }
      return (await res.json()) as QboQueryResponse;
    },
  };
}
