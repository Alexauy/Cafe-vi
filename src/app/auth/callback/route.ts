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
  const requestedNext = requestUrl.searchParams.get("next") ?? "/";
  const requestedNextUrl = new URL(requestedNext, requestUrl.origin);
  const next = requestedNextUrl.origin === requestUrl.origin
    ? `${requestedNextUrl.pathname}${requestedNextUrl.search}${requestedNextUrl.hash}`
    : "/";

  if (!code) {
    return NextResponse.redirect(new URL("/reset-password", requestUrl.origin));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(new URL("/reset-password", requestUrl.origin));
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/reset-password", requestUrl.origin));
  }

  return response;
}
