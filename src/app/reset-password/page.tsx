"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/user-facing-error";
import styles from "../login/login.module.css";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [validLink, setValidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured()) {
      setReady(true);
      return () => { active = false; };
    }

    void createClient().auth.getUser().then((result: { data: { user: unknown | null }; error: unknown | null }) => {
      if (!active) return;
      setValidLink(Boolean(result.data.user) && !result.error);
      setReady(true);
    }).catch(() => {
      if (!active) return;
      setValidLink(false);
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("Choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Those passwords don't match. Please try again.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        setMessage(userFacingError(error, "We couldn't update your password. Request a new reset link and try again."));
        return;
      }
      setSuccess(true);
    } catch (error) {
      setMessage(userFacingError(error, "We couldn't update your password. Request a new reset link and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Image className={styles.brand} src="/brand/cafeViSign.png" alt="Cafe-Vi" width={800} height={300} priority />
        <Link className={styles.back} href="/login"><span aria-hidden="true">←</span> BACK TO SIGN IN</Link>
      </header>
      <section className={styles.card}>
        <p className={styles.eyebrow}>A FRESH START</p>
        <h1>{success ? "Password updated." : "Choose a new password."}</h1>
        <p className={styles.intro}>{success ? "Your password has been changed. You can sign in with it now." : "Use at least 8 characters for your new password."}</p>
        {!ready ? <p className={styles.notice} role="status">Checking your reset link…</p> : !isSupabaseConfigured() ? (
          <p className={styles.notice} role="status">Password recovery isn&apos;t connected yet. Please try again later.</p>
        ) : success ? (
          <Link className={styles.submit} href="/login">BACK TO SIGN IN</Link>
        ) : !validLink ? (
          <>
            <p className={styles.notice} role="status">This reset link is missing, expired, or has already been used. Request a new one to continue.</p>
            <Link className={styles.submit} href="/login">REQUEST ANOTHER LINK</Link>
          </>
        ) : (
          <form onSubmit={(event) => void updatePassword(event)}>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            {message && <p className={styles.message} role="alert">{message}</p>}
            <button className={styles.submit} disabled={busy}>{busy ? "SAVING…" : "UPDATE PASSWORD"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
