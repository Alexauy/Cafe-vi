"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/user-facing-error";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "reset">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);

    try {
      const supabase = createClient();
      if (mode === "reset") {
        const callbackUrl = new URL("/auth/callback", window.location.origin);
        callbackUrl.searchParams.set("next", "/reset-password");
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl.toString() });
        if (error) throw error;
        setMessageTone("success");
        setMessage("If an account uses that email, a password reset link is on its way.");
      } else if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.replace("/");
          router.refresh();
        } else {
          setMessage("Check your email to confirm your account, then sign in here.");
        }
      }
    } catch (error) {
      setMessageTone("error");
      setMessage(userFacingError(error, mode === "sign-in" ? "We couldn't sign you in. Please try again." : mode === "reset" ? "We couldn't send a reset link. Please try again." : "We couldn't create your account. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Image className={styles.brand} src="/brand/cafeViSign.png" alt="Cafe-Vi" width={800} height={300} priority />
        <Link className={styles.back} href="/"><span aria-hidden="true">â†</span> BACK TO THE ROOM</Link>
      </header>
      <section className={styles.card}>
        <p className={styles.eyebrow}>YOUR INTERNET HANGOUT</p>
        <h1>{mode === "sign-in" ? "Welcome back." : mode === "sign-up" ? "Come on in." : "Reset your password."}</h1>
        <p className={styles.intro}>{mode === "reset" ? "Enter the email for your cafÃ© account and weâ€™ll send a reset link if itâ€™s registered." : "Sign in to keep your seat, avatar, and focus sessions in sync."}</p>
        {!configured && <p className={styles.notice}>Sign-in and saved profiles aren&apos;t connected yet. You can still explore the cafÃ© in preview mode.</p>}
        <form onSubmit={submit}>
          <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {mode !== "reset" && <label>Password<input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          {message && <p className={messageTone === "success" ? styles.notice : styles.message} role="status">{message}</p>}
          <button className={styles.submit} disabled={!configured || busy}>{busy ? "ONE MOMENT..." : mode === "sign-in" ? "SIGN IN" : mode === "sign-up" ? "CREATE ACCOUNT" : "SEND RESET LINK"}</button>
        </form>
        {mode === "sign-in" && <button className={styles.switchMode} onClick={() => { setMode("reset"); setMessage(""); setMessageTone("error"); }}>Forgot your password?</button>}
        {mode !== "reset" && <>
        <button className={styles.switchMode} onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(""); setMessageTone("error"); }}>
          {mode === "sign-in" ? "New to the cafe? Create an account." : "Already have an account? Sign in"}
        </button>
        </>}
        {mode === "reset" && <button className={styles.switchMode} onClick={() => { setMode("sign-in"); setMessage(""); setMessageTone("error"); }}>Back to sign in</button>}
      </section>
    </main>
  );
}
