"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { avatarOptions } from "@/lib/avatar-options";
import { userFacingError } from "@/lib/user-facing-error";
import styles from "./profile.module.css";

type ActivityRow = { activity_date: string; seconds_worked: number | string };
type DiaryRow = { entry_date: string; content: string };

function getPacificDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftMonth(monthKey: string, amount: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function formatDiaryDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatWorkTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}m`;
  if (hours) return `${hours}h`;
  return `${remainingMinutes}m`;
}

const configured = isSupabaseConfigured();
const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export default function ProfilePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [avatarId, setAvatarId] = useState<string>("cookie");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!configured);
  const [todayKey, setTodayKey] = useState(() => getPacificDateKey(new Date()));
  const [visibleMonth, setVisibleMonth] = useState(() => todayKey.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [activityByDate, setActivityByDate] = useState<Record<string, number>>({});
  const [diaryEntries, setDiaryEntries] = useState<Record<string, string>>({});
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState("");
  const [bookOpen, setBookOpen] = useState(false);
  const [diaryDraft, setDiaryDraft] = useState("");
  const [diaryBusy, setDiaryBusy] = useState(false);
  const [diaryMessage, setDiaryMessage] = useState("");

  useEffect(() => {
    const updateToday = () => setTodayKey(getPacificDateKey(new Date()));
    const timer = window.setInterval(updateToday, 30_000);
    document.addEventListener("visibilitychange", updateToday);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateToday);
    };
  }, []);

  useEffect(() => {
    if (!configured) return;
    let active = true;

    async function loadProfile() {
      const supabase = createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError) setMessage(userFacingError(authError, "We couldn't check your sign-in. Please try again."));
      if (!user) {
        setReady(true);
        return;
      }

      setUserId(user.id);
      const { data: profile, error } = await supabase.from("profiles")
        .select("username,avatar_id")
        .eq("id", user.id)
        .single();
      if (!active) return;
      if (error) setMessage(userFacingError(error, "We couldn't load your profile. Please try again."));
      if (profile) {
        setUsername(profile.username);
        setAvatarId(profile.avatar_id);
      }
      setReady(true);
    }

    void loadProfile();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!configured || !userId) return;
    let active = true;

    async function loadMonthlyActivity() {
      setCalendarBusy(true);
      setCalendarMessage("");
      const supabase = createClient();
      const monthStart = `${visibleMonth}-01`;
      const nextMonthStart = `${shiftMonth(visibleMonth, 1)}-01`;
      const [activityResult, diaryResult] = await Promise.all([
        supabase.rpc("get_monthly_activity", { p_month_start: monthStart }),
        supabase.from("diary_entries")
          .select("entry_date,content")
          .gte("entry_date", monthStart)
          .lt("entry_date", nextMonthStart)
          .order("entry_date"),
      ]);

      if (!active) return;
      const failure = activityResult.error ?? diaryResult.error;
      if (failure) {
        if (activityResult.error) console.error("Monthly activity request failed:", activityResult.error);
        if (diaryResult.error) console.error("Diary entries request failed:", diaryResult.error);
        setCalendarMessage(userFacingError(failure, "We couldn't load this month's activity. Please try again."));
      } else {
        const activity: Record<string, number> = {};
        for (const row of (activityResult.data ?? []) as ActivityRow[]) {
          activity[row.activity_date] = Number(row.seconds_worked);
        }
        const entries: Record<string, string> = {};
        for (const row of (diaryResult.data ?? []) as DiaryRow[]) entries[row.entry_date] = row.content;
        setActivityByDate(activity);
        setDiaryEntries(entries);
      }
      setCalendarBusy(false);
    }

    void loadMonthlyActivity();
    return () => { active = false; };
  }, [userId, visibleMonth]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !username.trim()) return;
    setBusy(true);
    setMessage("");
    const { error } = await createClient().from("profiles")
      .update({ username: username.trim(), avatar_id: avatarId })
      .eq("id", userId);
    setBusy(false);
    setMessage(error ? userFacingError(error, "We couldn't save your profile. Please try again.") : "Your profile is saved.");
  }

  function changeMonth(amount: number) {
    const nextMonth = shiftMonth(visibleMonth, amount);
    setVisibleMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
    setDiaryMessage("");
  }

  function openDiary(dateKey = selectedDate) {
    setSelectedDate(dateKey);
    if (dateKey !== todayKey && !diaryEntries[dateKey]) return;
    setDiaryDraft(diaryEntries[dateKey] ?? "");
    setDiaryMessage("");
    setBookOpen(true);
  }

  async function saveDiary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) return;
    if (selectedDate !== todayKey) {
      setDiaryMessage("You can only write or edit today's diary entry.");
      return;
    }
    const content = diaryDraft.trim();
    if (!content) {
      setDiaryMessage("Write a few words before saving your entry.");
      return;
    }
    if (content.length > 5000) {
      setDiaryMessage("Keep your entry under 5,000 characters.");
      return;
    }

    setDiaryBusy(true);
    setDiaryMessage("");
    const { error } = await createClient().from("diary_entries").upsert({
      user_id: userId,
      entry_date: selectedDate,
      content,
    }, { onConflict: "user_id,entry_date" });
    setDiaryBusy(false);
    if (error) {
      setDiaryMessage(userFacingError(error, "We couldn't save your diary entry. Please try again."));
      return;
    }

    setDiaryEntries((current) => ({ ...current, [selectedDate]: content }));
    setCalendarMessage("Your diary entry is saved.");
    setBookOpen(false);
  }

  const [year, month] = visibleMonth.split("-").map(Number);
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const calendarSlots: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dayCount }, (_, index) => index + 1),
  ];
  const mostActivity = Math.max(0, ...Object.values(activityByDate));
  const canGoForward = visibleMonth < todayKey.slice(0, 7);
  const canWriteDiary = selectedDate === todayKey;

  return (
    <main className={styles.page}>
      <header className={`${styles.header} cafe-banner`}>
        <Image className={styles.brand} src="/brand/cafeViSign.png" alt="Cafe-Vi" width={800} height={300} priority />
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span> Back to the room
        </Link>
      </header>
      {!configured ? (
        <section className={styles.card}>
          <h1>Your profile</h1>
          <p>Connect your café account to save your username, avatar, and daily notes between visits.</p>
          <Link className={styles.actionLink} href="/login">Go to sign in</Link>
        </section>
      ) : !ready ? (
        <p className={styles.loadingStatus}>Loading your profile…</p>
      ) : !userId ? (
        <section className={styles.card}>
          <h1>Your profile</h1>
          <p>Sign in to view your profile, activity calendar, and diary.</p>
          <Link className={styles.actionLink} href="/login">Sign in</Link>
        </section>
      ) : (
        <section className={`${styles.card} ${styles.dashboardCard}`}>
          <p className={styles.eyebrow}>YOUR LITTLE CORNER</p>
          <div className={styles.profileDashboard}>
            <section className={styles.accountPanel} aria-labelledby="profileTitle">
              <h1 id="profileTitle">Your profile</h1>
              <form onSubmit={(event) => void saveProfile(event)}>
                <label>Username<input required minLength={1} maxLength={24} value={username} onChange={(event) => setUsername(event.target.value)} /></label>
                <fieldset>
                  <legend>Your avatar</legend>
                  <div className={styles.avatars}>{avatarOptions.map((avatar) => <button key={avatar.id} type="button" className={`${styles.avatar} ${avatarId === avatar.id ? styles.selected : ""}`} onClick={() => setAvatarId(avatar.id)} aria-label={`Choose ${avatar.name} avatar`} aria-pressed={avatarId === avatar.id}><Image src={avatar.src} alt="" width={48} height={48} /></button>)}</div>
                </fieldset>
                {message && <p className={styles.status} role="status">{message}</p>}
                <button className={styles.save} disabled={busy || !username.trim()}>{busy ? "SAVING…" : "SAVE PROFILE"}</button>
              </form>
            </section>

            <section className={styles.activityPanel} aria-labelledby="activityTitle">
              <div className={styles.activityHeading}>
                <div>
                  <h2 id="activityTitle">Your monthly activity</h2>
                </div>
                <button className={styles.diaryBook} type="button" onClick={() => openDiary(todayKey)} aria-label={`Open today's diary for ${formatDiaryDate(todayKey)}`}>
                  <span className={styles.bookSpine} aria-hidden="true" />
                  <span className={styles.bookCopy}><b>DAILY DIARY</b><small>{diaryEntries[todayKey] ? "Read or edit today's note" : "Write a note for today"}</small></span>
                  <span className={styles.bookStamp} aria-hidden="true">✦</span>
                </button>
              </div>

              <div className={styles.calendarToolbar}>
                <button type="button" className={styles.monthArrow} aria-label="Show previous month" onClick={() => changeMonth(-1)}>←</button>
                <h3>{formatMonth(visibleMonth)}</h3>
                <button type="button" className={styles.monthArrow} aria-label="Show next month" disabled={!canGoForward} onClick={() => changeMonth(1)}>→</button>
              </div>
              <div className={styles.calendarGrid} role="group" aria-label={`${formatMonth(visibleMonth)} calendar`}>
                {weekdays.map((weekday) => <span key={weekday} className={styles.weekday}>{weekday}</span>)}
                {calendarSlots.map((day, index) => {
                  if (day === null) return <span key={`blank-${index}`} className={styles.blankDay} aria-hidden="true" />;
                  const dateKey = `${visibleMonth}-${String(day).padStart(2, "0")}`;
                  const seconds = activityByDate[dateKey] ?? 0;
                  const activityLevel = seconds > 0 && mostActivity > 0 ? Math.max(1, Math.ceil((seconds / mostActivity) * 4)) : 0;
                  const hasEntry = Boolean(diaryEntries[dateKey]);
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      className={`${styles.dayCell} ${styles[`activityLevel${activityLevel}`]} ${selectedDate === dateKey ? styles.selectedDay : ""}`}
                      aria-label={`${formatDiaryDate(dateKey)}: ${formatWorkTime(seconds)} completed focus time${hasEntry ? ", diary note saved" : ", no diary note"}`}
                      aria-pressed={selectedDate === dateKey}
                      disabled={dateKey > todayKey}
                      onClick={() => openDiary(dateKey)}
                    >
                      <span className={styles.dayNumber}>{day}</span>
                      <span className={styles.dayTime}>{formatWorkTime(seconds)}</span>
                      {hasEntry && <span className={styles.noteFlag}>note</span>}
                    </button>
                  );
                })}
              </div>
              {calendarBusy && <p className={styles.status} role="status">Gathering this month&apos;s café time…</p>}
              {calendarMessage && <p className={styles.status} role="status">{calendarMessage}</p>}
              <div className={styles.activityLegend}><span><i className={styles.legendSwatch} />More completed focus time appears darker</span><span>Times use Pacific days</span></div>
              <button className={styles.selectedDaySummary} type="button" disabled={!canWriteDiary && !diaryEntries[selectedDate]} onClick={() => openDiary()}>
                <span><b>{formatDiaryDate(selectedDate)}</b><small>{diaryEntries[selectedDate] ? (canWriteDiary ? "Your diary note is ready to edit" : "Your diary note is ready to read") : (canWriteDiary ? "Write today's diary note" : "No diary note for this day")}</small></span>
                <strong>{formatWorkTime(activityByDate[selectedDate] ?? 0)}</strong>
              </button>
            </section>
          </div>
        </section>
      )}

      {bookOpen && <div className={styles.bookBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBookOpen(false); }}>
        <section className={styles.bookDialog} role="dialog" aria-modal="true" aria-labelledby="diaryTitle">
          <button className={styles.closeBook} type="button" onClick={() => setBookOpen(false)} aria-label="Close diary">×</button>
          <p className={styles.activityEyebrow}>A PAGE FOR YOU</p>
          <h2 id="diaryTitle">{formatDiaryDate(selectedDate)}</h2>
          <p className={styles.bookPrompt}>{canWriteDiary ? "What would you like to remember about today? Only you can read this diary." : "This is a past entry. You can read it, but only today's page can be changed."}</p>
          <form onSubmit={(event) => void saveDiary(event)}>
            <label className={styles.srOnly} htmlFor="diaryEntry">Your diary entry</label>
            <textarea id="diaryEntry" autoFocus maxLength={5000} readOnly={!canWriteDiary} value={diaryDraft} onChange={(event) => setDiaryDraft(event.target.value)} placeholder={canWriteDiary ? "..." : "No entry for this day."} />
            <div className={styles.diaryActions}>
              <span>{diaryDraft.length}/5000</span>
              {canWriteDiary ? <button className={styles.save} type="submit" disabled={diaryBusy || !diaryDraft.trim()}>{diaryBusy ? "SAVING…" : "SAVE THIS PAGE"}</button> : <span>PAST ENTRY · READ ONLY</span>}
            </div>
            {diaryMessage && <p className={styles.status} role="status">{diaryMessage}</p>}
          </form>
        </section>
      </div>}
    </main>
  );
}
