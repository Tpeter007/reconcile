import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl } from "@/lib/qbo/oauth";

const STATE_COOKIE = "qbo_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const state = randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  const url = buildAuthorizeUrl(state);
  redirect(url);
}
