import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthRedirectUrl } from "@/lib/auth-redirect-url";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const hostedCallbackUrl = new URL(getAuthRedirectUrl("/auth/callback"));
  if (requestUrl.origin !== hostedCallbackUrl.origin) {
    const callbackPath = `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`;
    return NextResponse.redirect(new URL(callbackPath, hostedCallbackUrl.origin));
  }

  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = requestUrl.searchParams.get("type");
  const requestedNext = requestUrl.searchParams.get("next") ?? "/login?confirmed=1";
  const requestedNextUrl = new URL(requestedNext, requestUrl.origin);
  const safeNext = requestedNextUrl.origin === requestUrl.origin
    ? `${requestedNextUrl.pathname}${requestedNextUrl.search}${requestedNextUrl.hash}`
    : "/login";
  const nextUrl = new URL(safeNext, requestUrl.origin);
  const next = otpType === "recovery"
    ? "/reset-password?recovery=1"
    : nextUrl.pathname === "/reset-password"
      ? `${nextUrl.pathname}${nextUrl.search}${nextUrl.search ? "&" : "?"}recovery=1`
      : safeNext;
  const errorNext = next.startsWith("/reset-password")
    ? next
    : "/login?confirmation=failed";

  if (!code && !(tokenHash && otpType)) {
    const destination = otpType === "recovery"
      ? "/reset-password?recovery=1"
      : "/login?confirmation=failed";
    return NextResponse.redirect(new URL(destination, requestUrl.origin));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(new URL(errorNext, requestUrl.origin));
  }

  const response = NextResponse.redirect(new URL(next, requestUrl.origin));
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: otpType! });
  if (error) {
    return NextResponse.redirect(new URL(errorNext, requestUrl.origin));
  }

  return response;
}
