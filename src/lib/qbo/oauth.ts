import OAuthClient from "intuit-oauth";

type TokenSet = {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: Date;
  refresh_token_expires_at: Date;
  realm_id: string;
};

type IntuitTokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  realmId?: string;
};

const ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

function env() {
  const clientId = process.env.QBO_CLIENT_ID ?? "";
  const clientSecret = process.env.QBO_CLIENT_SECRET ?? "";
  const redirectUri = process.env.QBO_REDIRECT_URI ?? "";
  const environment = (process.env.QBO_ENVIRONMENT ?? "sandbox") as
    | "sandbox"
    | "production";
  return { clientId, clientSecret, redirectUri, environment };
}

function client(): OAuthClient {
  const { clientId, clientSecret, redirectUri, environment } = env();
  return new OAuthClient({
    clientId,
    clientSecret,
    redirectUri,
    environment,
  });
}

export function buildAuthorizeUrl(state: string): string {
  return client().authorizeUri({ scope: [ACCOUNTING_SCOPE], state });
}

function expiriesFromJson(json: IntuitTokenJson, anchor: Date) {
  const expiresIn = Number(json.expires_in ?? 0);
  const refreshExpiresIn = Number(json.x_refresh_token_expires_in ?? 0);
  return {
    access_token_expires_at: new Date(anchor.getTime() + expiresIn * 1000),
    refresh_token_expires_at: new Date(
      anchor.getTime() + refreshExpiresIn * 1000,
    ),
  };
}

export async function exchangeCodeForTokens(
  code: string,
  realmId: string,
): Promise<TokenSet> {
  const { redirectUri } = env();
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("realmId", realmId);
  url.searchParams.set("state", "exchange");

  const anchor = new Date();
  const response = await client().createToken(url.toString());
  const json = response.getJson() as IntuitTokenJson;

  if (!json.access_token || !json.refresh_token) {
    throw new Error("[qbo] token exchange returned no tokens");
  }

  const { access_token_expires_at, refresh_token_expires_at } = expiriesFromJson(
    json,
    anchor,
  );

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    access_token_expires_at,
    refresh_token_expires_at,
    realm_id: realmId,
  };
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const anchor = new Date();
  const response = await client().refreshUsingToken(refreshToken);
  const json = response.getJson() as IntuitTokenJson;

  if (!json.access_token || !json.refresh_token) {
    throw new Error("[qbo] token refresh returned no tokens");
  }

  const { access_token_expires_at, refresh_token_expires_at } = expiriesFromJson(
    json,
    anchor,
  );

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    access_token_expires_at,
    refresh_token_expires_at,
    realm_id: json.realmId ?? "",
  };
}
