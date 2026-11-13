"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { avatarOptions } from "@/lib/avatar-options";
import { userFacingError } from "@/lib/user-facing-error";
import styles from "./CafeRoom.module.css";

const roomTables = [
  { id: "round-back-left", type: "Round", position: "BackLeft", seatIds: [1, 2] },
  { id: "round-back-right", type: "Round", position: "BackRight", seatIds: [3, 4] },
  { id: "square-mid-left", type: "Square", position: "MidLeft", seatIds: [5, 6] },
  { id: "oval-mid", type: "Oval", position: "MidCenter", seatIds: [7, 8, 9, 10] },
  { id: "square-mid-right", type: "Square", position: "MidRight", seatIds: [11, 12] },
  { id: "rectangle-front-left", type: "Rectangle", position: "FrontLeft", seatIds: [13, 14, 15, 16] },
  { id: "rectangle-front-right", type: "Rectangle", position: "FrontRight", seatIds: [17, 18, 19, 20] },
] as const;

type Occupant = {
  name: string;
  avatar: string;
  userId?: string;
  task?: string;
  minutes?: number;
  endsAt?: string;
  status?: "active" | "completed";
};

type ProfileRow = { id: string; username: string; avatar_id: string };
type WelcomeProfileRow = Pick<ProfileRow, "username" | "avatar_id"> & { welcome_seen: boolean };
type SeatRow = { seat_no: number; state: string; occupant_id: string | null };
type SessionRow = { seat_no: number; task_name: string; ends_at: string; status: "active" | "completed" | "cancelled"; finished_at: string | null };
type ChatMessage = { id: string; room_id: string; user_id: string; content: string; created_at: string; username: string };
const reactionOptions = [
  { id: "thumb", src: "/emojis/thumbEmoji.png", label: "Thumbs up" },
  { id: "angry", src: "/emojis/angryEmoji.png", label: "Angry" },
  { id: "sad", src: "/emojis/sadEmoji.png", label: "Sad" },
  { id: "confetti", src: "/emojis/confettiEmoji.png", label: "Confetti" },
] as const;
const ambienceOptions = [
  { id: "cafe-ambience", label: "Cafe ambience", credit: "Deborah_Wong on Pixabay", src: "/audio/deborah-wong-cafe-sounds.mp3" },
  { id: "slow-jazz", label: "Slow jazz", credit: "freesound_community on Pixabay", src: "/audio/slow-jazz.mp3" },
  { id: "keyboard-typing", label: "Keyboard typing", credit: "freesound_community on Pixabay", src: "/audio/keyboard-typing.mp3" },
] as const;
type ReactionId = (typeof reactionOptions)[number]["id"];
type RoomReaction = { id: string; seat: number; emoji: ReactionId; createdAt: number };

function isRoomReaction(value: unknown): value is Pick<RoomReaction, "id" | "seat" | "emoji"> {
  if (typeof value !== "object" || value === null) return false;
  const reaction = value as Record<string, unknown>;
  return typeof reaction.id === "string"
    && typeof reaction.seat === "number"
    && Number.isInteger(reaction.seat)
    && reaction.seat >= 1
    && reaction.seat <= 20
    && reactionOptions.some((option) => option.id === reaction.emoji);
}

function parseChatMessage(value: unknown, fallbackUsername = "Cafe friend"): ChatMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.room_id !== "string"
    || typeof row.user_id !== "string" || typeof row.content !== "string"
    || typeof row.created_at !== "string") return null;
  const profile = row.profiles;
  const joinedProfile = Array.isArray(profile) ? profile[0] : profile;
  const username = typeof joinedProfile === "object" && joinedProfile !== null
    && "username" in joinedProfile && typeof joinedProfile.username === "string"
    ? joinedProfile.username
    : fallbackUsername;
  return { id: row.id, room_id: row.room_id, user_id: row.user_id, content: row.content, created_at: row.created_at, username };
}

function isChatMessageIdentity(value: unknown): value is { id: string; user_id: string } {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.user_id === "string";
}

function isChatMessageId(value: unknown): value is { id: string } {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Record<string, unknown>).id === "string";
}

function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()]
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

const demoOccupants: Record<number, Occupant> = {
  2: { name: "Mira", avatar: avatarOptions[1].src, task: "Sketching new ideas", minutes: 24 },
  5: { name: "Theo", avatar: avatarOptions[2].src, task: "Reading chapter 4", minutes: 18 },
  8: { name: "Jules", avatar: avatarOptions[3].src, task: "Finishing the proposal", minutes: 42 },
  11: { name: "Sam", avatar: avatarOptions[4].src, task: "Learning TypeScript", minutes: 31 },
  15: { name: "Ari", avatar: avatarOptions[0].src, task: "Planning the week", minutes: 12 },
};

const backendConfigured = isSupabaseConfigured();

function formatRemaining(occupant: Occupant, now: number) {
  if (!occupant.endsAt) return occupant.minutes ? `${occupant.minutes}:00` : "READY";
  const seconds = Math.max(0, Math.ceil((Date.parse(occupant.endsAt) - now) / 1000));
  if (!seconds) return "DONE";
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function CafeRoom() {
  const [occupants, setOccupants] = useState<Record<number, Occupant>>(() => backendConfigured ? {} : demoOccupants);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<string>(avatarOptions[1].src);
  const [name, setName] = useState("Alex");
  const [task, setTask] = useState("");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("25");
  const [userId, setUserId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [backendReady, setBackendReady] = useState(!backendConfigured);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roomMessage, setRoomMessage] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [welcomeNoticeOpen, setWelcomeNoticeOpen] = useState(false);
  const [welcomeNoticeBusy, setWelcomeNoticeBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [moderationError, setModerationError] = useState("");
  const [isModerator, setIsModerator] = useState(false);
  const [deletingChatMessageId, setDeletingChatMessageId] = useState<string | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [localSeat, setLocalSeat] = useState<number | null>(null);
  const [showInitialTaskCards, setShowInitialTaskCards] = useState(!backendConfigured);
  const [revealedTaskSeat, setRevealedTaskSeat] = useState<number | null>(null);
  const [reactionCooldown, setReactionCooldown] = useState(false);
  const reactionChannel = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const reactionCooldownTimer = useRef<number | null>(null);
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambienceSelectRef = useRef<HTMLDivElement | null>(null);
  const ambienceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [ambiencePlaying, setAmbiencePlaying] = useState(false);
  const [ambienceTrack, setAmbienceTrack] = useState<string>(ambienceOptions[0].id);
  const [ambienceMenuOpen, setAmbienceMenuOpen] = useState(false);
  const [ambienceVolume, setAmbienceVolume] = useState(0.35);
  const [ambienceError, setAmbienceError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const occupied = Object.keys(occupants).length;
  const availableSeats = 20 - occupied;

  const dismissWelcomeNotice = useCallback(async () => {
    if (welcomeNoticeBusy) return;
    setWelcomeNoticeBusy(true);
    try {
      if (userId) {
        const { error } = await createClient().from("profiles")
          .update({ welcome_seen: true })
          .eq("id", userId);
        if (error) {
          setRoomMessage(userFacingError(error, "We couldn't save that you've seen the welcome guide. Please try again."));
          return;
        }
      }
      setWelcomeNoticeOpen(false);
    } catch (error) {
      setRoomMessage(userFacingError(error, "We couldn't save that you've seen the welcome guide. Please try again."));
    } finally {
      setWelcomeNoticeBusy(false);
    }
  }, [userId, welcomeNoticeBusy]);

  useEffect(() => {
    if (!backendReady || userId) return;
    setWelcomeNoticeOpen(true);
  }, [backendReady, userId]);

  useEffect(() => {
    if (!welcomeNoticeOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissWelcomeNotice();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [welcomeNoticeOpen, dismissWelcomeNotice]);

  useEffect(() => {
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, []);

  useEffect(() => {
    if (!chatOpen || !backendConfigured || !roomId || !userId) return;
    let active = true;
    setChatLoading(true);
    setChatError("");

    async function loadChatHistory() {
      try {
        const { data, error } = await createClient().from("chat_messages")
          .select("id,room_id,user_id,content,created_at,profiles!chat_messages_user_id_fkey(username)")
          .eq("room_id", roomId)
          .order("created_at", { ascending: false });
        if (!active) return;
        if (error) {
          setChatError(userFacingError(error, "We couldn't load the chat. Please try again."));
          return;
        }
        const rows: unknown[] = data ?? [];
        const parsed = rows.map((row) => parseChatMessage(row)).filter((row): row is ChatMessage => row !== null);
        if (parsed.length !== rows.length) setChatError("Some recent chat messages couldn't be displayed.");
        setChatMessages((current) => mergeChatMessages(current, parsed.reverse()));
      } catch (error) {
        if (active) setChatError(userFacingError(error, "We couldn't load the chat. Please check your connection and try again."));
      } finally {
        if (active) setChatLoading(false);
      }
    }

    void loadChatHistory();
    return () => { active = false; };
  }, [chatOpen, roomId, userId]);

  useEffect(() => {
    if (chatOpen) chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    if (ambienceAudioRef.current) ambienceAudioRef.current.volume = ambienceVolume;
  }, [ambienceVolume]);

  useEffect(() => {
    if (!ambienceMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !ambienceSelectRef.current?.contains(event.target)) setAmbienceMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [ambienceMenuOpen]);

  useEffect(() => () => {
    ambienceAudioRef.current?.pause();
  }, []);

  async function toggleAmbience() {
    const audio = ambienceAudioRef.current;
    if (!audio) return;
    setAmbienceError(false);
    if (!audio.paused) {
      audio.pause();
      setAmbiencePlaying(false);
      return;
    }
    try {
      audio.volume = ambienceVolume;
      await audio.play();
      setAmbiencePlaying(true);
    } catch {
      setAmbiencePlaying(false);
      setAmbienceError(true);
    }
  }

  function chooseAmbience(trackId: string) {
    if (ambienceAudioRef.current) {
      ambienceAudioRef.current.pause();
      ambienceAudioRef.current.currentTime = 0;
    }
    setAmbiencePlaying(false);
    setAmbienceError(false);
    setAmbienceTrack(trackId);
  }

  useEffect(() => {
    if (!backendReady) return;
    setShowInitialTaskCards(true);
    const introTimer = window.setTimeout(() => setShowInitialTaskCards(false), 2600);
    return () => window.clearTimeout(introTimer);
  }, [backendReady]);

  useEffect(() => {
    const cleanup = window.setInterval(() => {
      const cutoff = Date.now() - 2400;
      setReactions((current) => current.filter((reaction) => reaction.createdAt > cutoff));
    }, 300);
    return () => window.clearInterval(cleanup);
  }, []);

  useEffect(() => () => {
    if (reactionCooldownTimer.current !== null) window.clearTimeout(reactionCooldownTimer.current);
  }, []);

  useEffect(() => {
    if (!backendConfigured) return;
    setOccupants((current) => {
      let changed = false;
      const next = { ...current };
      for (const [seat, occupant] of Object.entries(current)) {
        if (occupant.task && occupant.endsAt && now - Date.parse(occupant.endsAt) > 12_000) {
          next[Number(seat)] = { ...occupant, task: undefined, endsAt: undefined, status: undefined };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [now]);

  useEffect(() => {
    if (!backendConfigured) return;

    const supabase = createClient();
    let active = true;
    let roomChannel: ReturnType<typeof supabase.channel> | null = null;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let heartbeatTimer: number | null = null;
    let pageHideHandler: (() => void) | null = null;
    let visibilityChangeHandler: (() => void) | null = null;
    let onlineHandler: (() => void) | null = null;
    let authenticated = false;
    let heartbeatWarningShown = false;
    let heartbeatInFlight = false;
    const heartbeatWarning = "We're having trouble keeping your seat active. Check your connection and try again.";

    async function sendHeartbeat() {
      if (!active || !authenticated || heartbeatInFlight) return;
      heartbeatInFlight = true;
      try {
        const { error } = await supabase.rpc("heartbeat_cafe_presence");
        if (!active) return;
        if (error) {
          if (!heartbeatWarningShown) setRoomMessage(heartbeatWarning);
          heartbeatWarningShown = true;
          return;
        }
        heartbeatWarningShown = false;
        setRoomMessage((current) => current === heartbeatWarning ? "" : current);
      } catch {
        if (active && !heartbeatWarningShown) setRoomMessage(heartbeatWarning);
        heartbeatWarningShown = true;
      } finally {
        heartbeatInFlight = false;
      }
    }

    async function refreshRoom(roomId: string) {
      const [seatResult, profileResult, sessionResult] = await Promise.all([
        supabase.from("seats").select("seat_no,state,occupant_id").eq("room_id", roomId),
        supabase.from("profiles").select("id,username,avatar_id"),
        supabase.from("work_sessions").select("seat_no,user_id,task_name,ends_at,status,finished_at")
          .eq("room_id", roomId)
          .gte("started_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order("started_at", { ascending: false }),
      ]);

      if (!active) return;
      const failure = seatResult.error ?? profileResult.error ?? sessionResult.error;
      if (failure) {
        setRoomMessage(userFacingError(failure, "We couldn't load the café right now. Please try again."));
        return;
      }

      const profileRows = (profileResult.data ?? []) as unknown as ProfileRow[];
      const seatRows = (seatResult.data ?? []) as unknown as SeatRow[];
      const sessionRows = (sessionResult.data ?? []) as unknown as SessionRow[];
      const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
      const sessionBySeat = new Map<number, SessionRow>();
      const completionCutoff = Date.now() - 12_000;
      for (const session of sessionRows) {
        const finishedAt = session.finished_at ? Date.parse(session.finished_at) : Date.parse(session.ends_at);
        if (session.status === "cancelled") continue;
        if (session.status === "completed" && finishedAt < completionCutoff) continue;
        if (!sessionBySeat.has(session.seat_no)) sessionBySeat.set(session.seat_no, session);
      }

      const nextOccupants: Record<number, Occupant> = {};
      for (const seat of seatRows) {
        if (!seat.occupant_id || seat.state === "available") continue;
        const profile = profileById.get(seat.occupant_id);
        const session = sessionBySeat.get(seat.seat_no);
        const avatar = avatarOptions.find((option) => option.id === profile?.avatar_id) ?? avatarOptions[1];
        nextOccupants[seat.seat_no] = {
          name: profile?.username ?? "Cafe friend",
          avatar: avatar.src,
          userId: seat.occupant_id,
          task: session?.task_name ?? undefined,
          endsAt: session?.ends_at ?? undefined,
          status: session?.status === "completed" ? "completed" : "active",
        };
      }
      setOccupants(nextOccupants);
      setRoomMessage("");
    }

    async function connect() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!active) return;
      if (userError) {
        setRoomMessage(userFacingError(userError, "We couldn't check your sign-in. Please sign in again."));
        setBackendReady(true);
        return;
      }
      if (userData.user) {
        authenticated = true;
        setUserId(userData.user.id);
        const { data: moderator, error: moderatorError } = await supabase.from("chat_moderators")
          .select("user_id")
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (!active) return;
        if (moderatorError) {
          setModerationError(userFacingError(moderatorError, "We couldn't check chat moderation access."));
        } else {
          setIsModerator(Boolean(moderator));
        }

        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("username,avatar_id,welcome_seen")
          .eq("id", userData.user.id)
          .single();
        const profile = profileData as unknown as WelcomeProfileRow | null;
        if (profileError) setRoomMessage(userFacingError(profileError, "We couldn't load your profile. Please try again."));
        if (profile) {
          if (!profile.welcome_seen) setWelcomeNoticeOpen(true);
          setName(profile.username);
          const avatar = avatarOptions.find((option) => option.id === profile.avatar_id);
          if (avatar) setSelectedAvatar(avatar.src);
        }
      }

      const { data: room, error: roomError } = await supabase.from("rooms").select("id").eq("slug", "cafe-vi").single();
      if (!active) return;
      if (roomError || !room) {
        setRoomMessage(roomError ? userFacingError(roomError, "The café room isn't ready yet. Please try again later.") : "The café room isn't ready yet. Please try again later.");
        setBackendReady(true);
        return;
      }

      setRoomId(room.id);
      await refreshRoom(room.id);
      if (!active) return;
      roomChannel = supabase.channel(`cafe-room:${room.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "seats", filter: `room_id=eq.${room.id}` }, () => { void refreshRoom(room.id); })
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => { void refreshRoom(room.id); })
        .on("postgres_changes", { event: "*", schema: "public", table: "work_sessions", filter: `room_id=eq.${room.id}` }, () => { void refreshRoom(room.id); })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${room.id}` }, async (event: { new: unknown }) => {
          const payload = event.new;
          if (!isChatMessageIdentity(payload)) return;
          const { data: messageData, error: messageError } = await supabase.from("chat_messages")
            .select("id,room_id,user_id,content,created_at,profiles!chat_messages_user_id_fkey(username)")
            .eq("id", payload.id)
            .single();
          if (!active) return;
          if (messageError) {
            console.error("New chat message could not be loaded:", messageError);
            setChatError(userFacingError(messageError, "A new chat message couldn't be loaded."));
            return;
          }
          const message = parseChatMessage(messageData);
          if (!message) {
            setChatError("A new chat message couldn't be displayed. Please reopen the chat.");
            return;
          }
          setChatMessages((current) => mergeChatMessages(current, [message]));
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, (event: { old: unknown }) => {
          if (!isChatMessageId(event.old)) return;
          const deletedId = event.old.id;
          setChatMessages((current) => current.filter((message) => message.id !== deletedId));
        })
        .on("broadcast", { event: "room-reaction" }, ({ payload }: { payload: unknown }) => {
          if (!isRoomReaction(payload)) return;
          const reaction = payload;
          setReactions((current) => [...current.filter((item) => item.id !== reaction.id), {
            id: reaction.id,
            seat: reaction.seat,
            emoji: reaction.emoji,
            createdAt: Date.now(),
          }]);
        })
        .subscribe();
      reactionChannel.current = roomChannel;
      if (authenticated) {
        void sendHeartbeat();
        heartbeatTimer = window.setInterval(() => { void sendHeartbeat(); }, 15_000);
        visibilityChangeHandler = () => {
          if (document.visibilityState === "visible") void sendHeartbeat();
        };
        document.addEventListener("visibilitychange", visibilityChangeHandler);
        onlineHandler = () => { void sendHeartbeat(); };
        window.addEventListener("online", onlineHandler);
        pageHideHandler = () => { void supabase.rpc("mark_cafe_disconnected"); };
        window.addEventListener("pagehide", pageHideHandler);
      }
      setBackendReady(true);
    }

    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "SIGNED_OUT" && active) {
        authenticated = false;
        if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        setUserId(null);
        setIsModerator(false);
        setRoomMessage("");
      }
    });
    authSubscription = data.subscription;
    void connect();

    return () => {
      active = false;
      authSubscription?.unsubscribe();
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (visibilityChangeHandler) document.removeEventListener("visibilitychange", visibilityChangeHandler);
      if (onlineHandler) window.removeEventListener("online", onlineHandler);
      if (pageHideHandler) window.removeEventListener("pagehide", pageHideHandler);
      if (roomChannel) void supabase.removeChannel(roomChannel);
      reactionChannel.current = null;
    };
  }, []);

  function toggleChatRoom() {
    setChatOpen((open) => !open);
  }

  function closeChatRoom() {
    setChatOpen(false);
  }

  async function signOut() {
    setSigningOut(true);
    setRoomMessage("");
    try {
      if (userId) {
        const { error: leaveError } = await createClient().rpc("leave_cafe");
        if (leaveError) {
          setRoomMessage(userFacingError(leaveError, "We couldn't release your seat. Please try again before signing out."));
          return;
        }
        setOccupants((current) => Object.fromEntries(
          Object.entries(current).filter(([, occupant]) => occupant.userId !== userId),
        ));
        setLocalSeat(null);
      }

      const { error } = await createClient().auth.signOut();
      if (error) {
        setRoomMessage(userFacingError(error, "We couldn't sign you out. Please try again."));
        return;
      }

      setUserId(null);
      setIsModerator(false);
    } catch (error) {
      setRoomMessage(userFacingError(error, "We couldn't sign you out. Please try again."));
    } finally {
      setSigningOut(false);
    }
  }

  async function claimSeat(seat: number) {
    if (occupants[seat] || busy) return;
    setRoomMessage("");
    if (backendConfigured) {
      if (!backendReady || !userId) return;
      setBusy(true);
      const { error } = await createClient().rpc("claim_seat", { p_seat_no: seat });
      setBusy(false);
      if (error) {
        setRoomMessage(userFacingError(error, "We couldn't save that seat. Please try another."));
        return;
      }
    }
    setSelected(seat);
  }

  async function cancelSeatClaim() {
    setSelected(null);
    setTask("");
    if (backendConfigured) {
      const { error } = await createClient().rpc("leave_cafe");
      if (error) setRoomMessage(userFacingError(error, "We couldn't release your seat. Please try again."));
    }
  }

  async function startSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null || !name.trim() || !task.trim() || busy) return;
    setRoomMessage("");

    // Read the submitted form values directly and treat an empty unit as zero.
    const submittedTime = new FormData(event.currentTarget);
    const submittedHours = String(submittedTime.get("durationHours") ?? "").trim();
    const submittedMinutes = String(submittedTime.get("durationMinutes") ?? "").trim();
    const hourCount = submittedHours === "" ? 0 : Number(submittedHours);
    const minuteCount = submittedMinutes === "" ? 0 : Number(submittedMinutes);
    if (!Number.isInteger(hourCount) || !Number.isInteger(minuteCount)
      || hourCount < 0 || hourCount > 24 || minuteCount < 0 || minuteCount > 59
      || hourCount * 60 + minuteCount < 1 || hourCount * 60 + minuteCount > 1440) {
      const enteredHours = submittedHours || "0";
      const enteredMinutes = submittedMinutes || "0";
      setRoomMessage(`The entered time (${enteredHours} hours, ${enteredMinutes} minutes) is invalid. Enter a whole duration from 1 minute to 24 hours; for 1 minute, use 0 hours and 1 minute.`);
      return;
    }
    const durationMinutes = hourCount * 60 + minuteCount;
    setLocalSeat(selected);

    if (backendConfigured && userId) {
      const avatar = avatarOptions.find((option) => option.src === selectedAvatar) ?? avatarOptions[1];
      setBusy(true);
      const supabase = createClient();
      const { error: profileError } = await supabase.from("profiles")
        .update({ username: name.trim(), avatar_id: avatar.id })
        .eq("id", userId);
      if (profileError) {
        setBusy(false);
        setRoomMessage(userFacingError(profileError, "We couldn't save your profile. Please try again."));
        return;
      }
      const { data, error } = await supabase.rpc("start_work_session", {
        p_task_name: task.trim(),
        p_duration_minutes: durationMinutes,
      });
      setBusy(false);
      if (error) {
        setRoomMessage(userFacingError(error, "We couldn't start your task. Please check the details and try again."));
        return;
      }
      const session = data as unknown as { ends_at: string };
      setOccupants((current) => ({
        ...current,
        [selected]: { name: name.trim(), avatar: avatar.src, userId, task: task.trim(), endsAt: session.ends_at, status: "active" },
      }));
    } else {
      setOccupants((current) => ({
        ...current,
        [selected]: { name: name.trim(), avatar: selectedAvatar, task: task.trim(), minutes: durationMinutes, endsAt: new Date(Date.now() + durationMinutes * 60_000).toISOString(), status: "active" },
      }));
    }

    setSelected(null);
    setTask("");
  }

  async function leaveSeat(seat: number) {
    const occupant = occupants[seat];
    if (backendConfigured) {
      if (!occupant || occupant.userId !== userId) return;
      const { error } = await createClient().rpc("leave_cafe");
      if (error) {
        setRoomMessage(userFacingError(error, "We couldn't release your seat. Please try again."));
        return;
      }
    }
    setOccupants((current) => {
      const next = { ...current };
      delete next[seat];
      return next;
    });
    setLocalSeat((current) => current === seat ? null : current);
  }

  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = chatDraft.trim();
    if (!content || content.length > 500 || chatBusy || !roomId || !userId) return;
    setChatBusy(true);
    setChatError("");
    try {
      const { data, error } = await createClient().from("chat_messages")
        .insert({ room_id: roomId, user_id: userId, content })
        .select("id,room_id,user_id,content,created_at,profiles!chat_messages_user_id_fkey(username)")
        .single();
      if (error) {
        setChatError(userFacingError(error, "We couldn't send your message. Please try again."));
        return;
      }
      const message = parseChatMessage(data, name.trim() || "Cafe friend");
      if (!message) {
        setChatError("Your message was sent, but couldn't be displayed. Please reopen the chat.");
        setChatDraft("");
        return;
      }
      setChatMessages((current) => mergeChatMessages(current, [message]));
      setChatDraft("");
    } catch (error) {
      setChatError(userFacingError(error, "We couldn't send your message. Please check your connection and try again."));
    } finally {
      setChatBusy(false);
    }
  }

  async function deleteChatMessage(messageId: string) {
    if (!isModerator || deletingChatMessageId) return;
    setDeletingChatMessageId(messageId);
    setChatError("");
    try {
      const { data, error } = await createClient().from("chat_messages")
        .delete()
        .eq("id", messageId)
        .select("id")
        .single();
      if (error) {
        setChatError(userFacingError(error, "We couldn't delete that chat message. Please try again."));
        return;
      }
      if (!data) {
        setChatError("That message was not deleted. Your moderator access may have changed.");
        return;
      }
      setChatMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (error) {
      setChatError(userFacingError(error, "We couldn't delete that chat message. Please check your connection and try again."));
    } finally {
      setDeletingChatMessageId(null);
    }
  }

  function sendReaction(emoji: ReactionId) {
    if (reactionCooldown) return;
    const ownSeat = backendConfigured
      ? Object.entries(occupants).find(([, occupant]) => occupant.userId === userId)?.[0]
      : localSeat?.toString();
    if (!ownSeat) return;
    setReactionCooldown(true);
    reactionCooldownTimer.current = window.setTimeout(() => {
      setReactionCooldown(false);
      reactionCooldownTimer.current = null;
    }, 1000);
    const reaction: RoomReaction = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, seat: Number(ownSeat), emoji, createdAt: Date.now() };
    setReactions((current) => [...current, reaction]);
    void reactionChannel.current?.send({ type: "broadcast", event: "room-reaction", payload: reaction });
  }

  return (
    <main className={styles.page}>
      <header className={`${styles.topbar} cafe-banner`}>
        <div className={styles.topLeft}>
          <Link className={styles.profile} href="/profile" aria-label="Profile">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7v1H4z" />
            </svg>
          </Link>
        </div>
        <div className={styles.bannerActions}>
          <div className={styles.chatDock}>
            <button
              type="button"
              className={`${styles.chatTab} ${chatOpen ? styles.chatTabOpen : ""}`}
              onClick={toggleChatRoom}
              aria-expanded={chatOpen}
              aria-controls="cafe-chat-panel"
            >
              Chatroom
            </button>
            <section className={styles.chatPanel} id="cafe-chat-panel" aria-label="Chatroom" hidden={!chatOpen}>
              <header className={styles.chatHeader}>
                <div>
                  <h2>Chatroom</h2>
                  <p>A cozy little place to say hello.</p>
                </div>
                <button type="button" className={styles.chatClose} onClick={closeChatRoom} aria-label="Close chatroom">×</button>
              </header>
              <p className={styles.chatModerationNotice}>Chats will be moderated and deleted if inappropriate, be mindful!</p>
              <div className={styles.chatMessages} role="log" aria-live="polite" aria-relevant="additions text">
                {!backendConfigured ? (
                  <p className={styles.chatNotice}>Connect the café account to join the live chat.</p>
                ) : !backendReady ? (
                  <p className={styles.chatNotice}>Opening the chat…</p>
                ) : !userId ? (
                  <p className={styles.chatNotice}>Sign in to join the conversation.</p>
                ) : chatLoading && chatMessages.length === 0 ? (
                  <p className={styles.chatNotice}>Gathering the latest messages…</p>
                ) : chatMessages.length ? (
                  chatMessages.map((message) => {
                    const ownMessage = message.user_id === userId;
                    return <div key={message.id} className={`${styles.chatMessage} ${ownMessage ? styles.chatOwn : styles.chatOther}`}>
                      <span className={styles.chatUsername}>{message.username}</span>
                      <div className={styles.chatBubbleRow}>
                        <p className={styles.chatBubble}>{message.content}</p>
                        {isModerator && <button
                          type="button"
                          className={styles.chatDelete}
                          disabled={deletingChatMessageId !== null}
                          onClick={() => void deleteChatMessage(message.id)}
                          aria-label={`Delete message from ${message.username}`}
                          title={`Delete message from ${message.username}`}
                        >×</button>}
                      </div>
                    </div>;
                  })
                ) : (
                  <p className={styles.chatNotice}>It&apos;s quiet here. Say hello!</p>
                )}
                <div ref={chatMessagesEndRef} />
              </div>
              {(chatError || moderationError) && <p className={styles.chatError} role="alert">{chatError || moderationError}</p>}
              {backendConfigured && userId && <form className={styles.chatForm} onSubmit={(event) => void sendChatMessage(event)}>
                <input
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  maxLength={500}
                  aria-label="Write a chat message"
                  placeholder="Write a little message…"
                />
                <button type="submit" disabled={!chatDraft.trim() || chatBusy}>{chatBusy ? "…" : "Send"}</button>
              </form>}
            </section>
          </div>
          <div className={styles.topRight}>
            <span className={styles.capacity}><b className={styles.vacancyCount}>{availableSeats}</b><span>SEATS<br />AVAILABLE</span></span>
            {userId ? (
              <button className={styles.signIn} type="button" onClick={() => void signOut()} disabled={signingOut}>
                {signingOut ? "SIGNING OUT..." : "SIGN OUT"}
              </button>
            ) : (
              <Link className={styles.signIn} href="/login">SIGN IN / SIGN UP</Link>
            )}
          </div>
        </div>
      </header>

      <section className={styles.intro}>
        <Image className={styles.cafeSign} src="/brand/cafeViSign.png" alt="Cafe-Vi" width={1600} height={600} priority />
        <div className={styles.tagSlot} aria-hidden="true" />
      </section>

      <div className={styles.roomStage}>
      <section className={styles.room} id="room" aria-label="Shared café seating">
        <div className={styles.wallLeft} aria-hidden="true" />
        <div className={styles.wallRight} aria-hidden="true" />
        <svg className={styles.windowLightStreams} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="leftWindowLight" x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0" stopColor="#fff0bd" stopOpacity=".36" />
              <stop offset=".48" stopColor="#ffe6a5" stopOpacity=".20" />
              <stop offset="1" stopColor="#ffe6a5" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="rightWindowLight" x1="1" y1="0" x2="0.65" y2="1">
              <stop offset="0" stopColor="#fff0bd" stopOpacity=".36" />
              <stop offset=".48" stopColor="#ffe6a5" stopOpacity=".20" />
              <stop offset="1" stopColor="#ffe6a5" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M160 285 L405 162 L535 525 L365 600 Z" fill="url(#leftWindowLight)" />
          <path d="M215 270 L266 244 L465 584 L414 610 Z" fill="url(#leftWindowLight)" opacity=".65" />
          <path d="M595 162 L840 285 L635 600 L465 525 Z" fill="url(#rightWindowLight)" />
          <path d="M734 244 L785 270 L586 610 L535 584 Z" fill="url(#rightWindowLight)" opacity=".65" />
        </svg>
        <svg className={styles.wallWindows} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <g vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round">
            <path d="M150 190 L420 55 L420 155 L150 300 Z" fill="#f6df91" stroke="#50371f" strokeWidth="16" />
            <path d="M150 190 L420 55 L420 155 L150 300 Z" fill="none" stroke="#bd8748" strokeWidth="7" />
            <path d="M285 123 L285 228 M152 245 L418 105" fill="none" stroke="#704824" strokeWidth="9" />
            <path d="M580 55 L850 190 L850 300 L580 155 Z" fill="#f6df91" stroke="#50371f" strokeWidth="16" />
            <path d="M580 55 L850 190 L850 300 L580 155 Z" fill="none" stroke="#bd8748" strokeWidth="7" />
            <path d="M715 123 L715 228 M582 105 L848 245" fill="none" stroke="#704824" strokeWidth="9" />
          </g>
        </svg>
        <svg className={styles.wallTrim} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 0 410 L 500 140 L 1000 410" fill="none" stroke="#67452d" strokeWidth="10" vectorEffect="non-scaling-stroke" />
          <path d="M 500 0 L 1000 250 L 1000 750 L 500 1000 L 0 750 L 0 250 Z" fill="none" stroke="#67452d" strokeWidth="10" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className={`${styles.planter} ${styles.planterLeft}`} aria-hidden="true"><Image src="/room/cafeViLight.png" alt="" fill sizes="(max-width: 480px) 72px, (max-width: 760px) 92px, 144px" /></div>
        <div className={`${styles.planter} ${styles.planterRight}`} aria-hidden="true"><Image src="/room/cafeViLight.png" alt="" fill sizes="(max-width: 480px) 72px, (max-width: 760px) 92px, 144px" /></div>
        <svg className={`${styles.hangingPlant} ${styles.hangingPlantLeft}`} viewBox="0 0 100 150" aria-hidden="true">
          <path d="M50 0v30M35 30h30" fill="none" stroke="#67452d" strokeWidth="3" strokeLinecap="round" />
          <path d="M35 30h30l-5 24H40z" fill="#a8754e" stroke="#67452d" strokeWidth="2" strokeLinejoin="round" />
          <path d="M43 52c-2 17-11 20-7 32 3 8 11 8 11 18M56 52c4 15 14 19 10 29-3 7-10 9-9 20M50 54v31" fill="none" stroke="#526742" strokeWidth="3" strokeLinecap="round" />
          <path d="M39 69c-12-10-19 1-12 8 4 4 10 1 12-8Zm13 8c-13-8-18 4-10 10 5 3 10-1 10-10Zm14-6c12-10 19 1 12 8-4 4-10 1-12-8ZM49 97c-11-8-17 3-9 9 5 3 9-1 9-9Zm7-6c12-9 18 2 10 8-5 4-10 0-10-8Z" fill="#87966b" stroke="#40553a" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M38 43h24" stroke="#d7a66e" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <svg className={`${styles.hangingPlant} ${styles.hangingPlantRight}`} viewBox="0 0 100 150" aria-hidden="true">
          <path d="M50 0v30M35 30h30" fill="none" stroke="#67452d" strokeWidth="3" strokeLinecap="round" />
          <path d="M35 30h30l-5 24H40z" fill="#a8754e" stroke="#67452d" strokeWidth="2" strokeLinejoin="round" />
          <path d="M43 52c-2 17-11 20-7 32 3 8 11 8 11 18M56 52c4 15 14 19 10 29-3 7-10 9-9 20M50 54v31" fill="none" stroke="#526742" strokeWidth="3" strokeLinecap="round" />
          <path d="M39 69c-12-10-19 1-12 8 4 4 10 1 12-8Zm13 8c-13-8-18 4-10 10 5 3 10-1 10-10Zm14-6c12-10 19 1 12 8-4 4-10 1-12-8ZM49 97c-11-8-17 3-9 9 5 3 9-1 9-9Zm7-6c12-9 18 2 10 8-5 4-10 0-10-8Z" fill="#87966b" stroke="#40553a" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M38 43h24" stroke="#d7a66e" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <svg className={`${styles.cornerPlant} ${styles.cornerPlantLeft}`} viewBox="0 0 120 130" aria-hidden="true">
          <path d="M23 84c-8-5-7-17 2-22-5-9 1-20 12-21 1-12 14-18 23-10 8-9 23-5 25 7 12-2 21 8 17 19 10 7 9 20-1 26 3 9-6 16-15 13H38c-8 3-17-3-15-12Z" fill="#87966b" stroke="#40553a" strokeWidth="2" strokeLinejoin="round" />
          <path d="M31 57c-2-7 3-12 10-12 4-8 13-9 19-3 7-6 16-3 17 5 8-1 12 6 9 12 6 5 3 13-4 15H39c-7 0-11-8-8-14Z" fill="#a9bd83" />
          <path d="M42 86h36l-5 34H47z" fill="#a8754e" stroke="#67452d" strokeWidth="2" strokeLinejoin="round" />
          <path d="M40 86h40v8H40z" fill="#c18b5f" stroke="#67452d" strokeWidth="2" />
          <path d="M49 103h22" stroke="#d7a66e" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <svg className={`${styles.cornerPlant} ${styles.cornerPlantRight}`} viewBox="0 0 120 130" aria-hidden="true">
          <path d="M23 84c-8-5-7-17 2-22-5-9 1-20 12-21 1-12 14-18 23-10 8-9 23-5 25 7 12-2 21 8 17 19 10 7 9 20-1 26 3 9-6 16-15 13H38c-8 3-17-3-15-12Z" fill="#87966b" stroke="#40553a" strokeWidth="2" strokeLinejoin="round" />
          <path d="M31 57c-2-7 3-12 10-12 4-8 13-9 19-3 7-6 16-3 17 5 8-1 12 6 9 12 6 5 3 13-4 15H39c-7 0-11-8-8-14Z" fill="#a9bd83" />
          <path d="M42 86h36l-5 34H47z" fill="#a8754e" stroke="#67452d" strokeWidth="2" strokeLinejoin="round" />
          <path d="M40 86h40v8H40z" fill="#c18b5f" stroke="#67452d" strokeWidth="2" />
          <path d="M49 103h22" stroke="#d7a66e" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <svg className={`${styles.cornerPlant} ${styles.cornerPlantBack}`} viewBox="0 0 120 130" aria-hidden="true">
          <path d="M23 84c-8-5-7-17 2-22-5-9 1-20 12-21 1-12 14-18 23-10 8-9 23-5 25 7 12-2 21 8 17 19 10 7 9 20-1 26 3 9-6 16-15 13H38c-8 3-17-3-15-12Z" fill="#87966b" stroke="#40553a" strokeWidth="2" strokeLinejoin="round" />
          <path d="M31 57c-2-7 3-12 10-12 4-8 13-9 19-3 7-6 16-3 17 5 8-1 12 6 9 12 6 5 3 13-4 15H39c-7 0-11-8-8-14Z" fill="#a9bd83" />
          <path d="M42 86h36l-5 34H47z" fill="#a8754e" stroke="#67452d" strokeWidth="2" strokeLinejoin="round" />
          <path d="M40 86h40v8H40z" fill="#c18b5f" stroke="#67452d" strokeWidth="2" />
          <path d="M49 103h22" stroke="#d7a66e" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div className={styles.tables}>
          {roomTables.map((table) => (
            <div key={table.id} className={`${styles.tableGroup} ${styles[`table${table.type}`]} ${styles[`position${table.position}`]}`}>
              <div className={styles.table}><span>✿</span><span className={styles.tableCup}>◌</span></div>
              {table.seatIds.map((seat, seatIndex) => {
                const occupant = occupants[seat];
                  const isOwnTask = Boolean(occupant && (backendConfigured ? occupant.userId === userId : seat === localSeat));
                  const taskCardVisible = isOwnTask || showInitialTaskCards || revealedTaskSeat === seat;
                return <div key={seat} className={`${styles.seat} ${styles[`seatPosition${seatIndex + 1}`]} ${occupant ? styles.taken : styles.available}`}>
                    {occupant ? <div
                      className={`${styles.person} ${isOwnTask ? styles.ownPerson : ""}`}
                      title={`${occupant.name}${occupant.task ? ` — ${occupant.task}` : ""}`}
                      aria-label={occupant.task ? `${occupant.name}. Task: ${occupant.task}. Remaining ${formatRemaining(occupant, now)}.` : occupant.name}
                      tabIndex={occupant.task ? 0 : undefined}
                      onMouseEnter={() => { if (occupant.task) setRevealedTaskSeat(seat); }}
                      onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) setRevealedTaskSeat((current) => current === seat ? null : current); }}
                      onFocus={() => { if (occupant.task) setRevealedTaskSeat(seat); }}
                      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !event.currentTarget.matches(":hover")) setRevealedTaskSeat((current) => current === seat ? null : current); }}
                    >
                      {reactions.filter((reaction) => reaction.seat === seat).map((reaction) => {
                        const emoji = reactionOptions.find((option) => option.id === reaction.emoji)!;
                        return <span className={styles.reactionBubble} key={reaction.id}><Image src={emoji.src} alt={emoji.label} width={54} height={54} /></span>;
                      })}
                      {occupant.task && <div className={`${styles.taskCard} ${taskCardVisible ? styles.taskCardVisible : ""}`} aria-hidden={!taskCardVisible}>
                        <span className={styles.taskName}>{occupant.task}</span>
                        <span className={styles.taskTime}>{occupant.status === "completed" ? "DONE" : formatRemaining(occupant, now)}</span>
                      </div>}
                      <span className={styles.avatar}><Image src={occupant.avatar} alt="" width={58} height={58} /></span>
                      <span className={styles.personName}>{occupant.name}</span>
                      {(!backendConfigured || occupant.userId === userId) && <button className={styles.leave} onClick={() => void leaveSeat(seat)} aria-label={`Leave seat ${seat}`}>×</button>}
                    </div> : <button className={styles.emptySeat} disabled={backendConfigured && !backendReady} onClick={() => void claimSeat(seat)} aria-label={`Claim available seat ${seat}`}><span>+</span></button>}
                </div>;
              })}
            </div>
          ))}
        </div>
        <div className={styles.roomFooter}>
          <span>✦ &nbsp;A GOOD DAY TO BEGIN</span>
        </div>
      </section>
      </div>
      <div className={styles.ambienceControl}>
        <audio ref={ambienceAudioRef} src={ambienceOptions.find((option) => option.id === ambienceTrack)?.src ?? ambienceOptions[0].src} loop preload="none" onPlay={() => setAmbiencePlaying(true)} onPause={() => setAmbiencePlaying(false)} onError={() => setAmbienceError(true)} />
        <div className={styles.ambienceSelectLabel} ref={ambienceSelectRef}>
          <span>CHOOSE AUDIO</span>
          <button type="button" ref={ambienceTriggerRef} className={styles.ambienceSelectButton} aria-label="Choose audio" aria-haspopup="listbox" aria-expanded={ambienceMenuOpen} aria-controls="cafe-audio-options" onClick={() => setAmbienceMenuOpen((open) => !open)}>
            <span>{ambienceOptions.find((option) => option.id === ambienceTrack)?.label}</span><span aria-hidden="true">⌃</span>
          </button>
          {ambienceMenuOpen && <div className={styles.ambienceOptions} id="cafe-audio-options" role="listbox" aria-label="Audio choices">
            {ambienceOptions.map((option, index) => <button key={option.id} type="button" role="option" aria-selected={ambienceTrack === option.id} className={styles.ambienceOption} onClick={() => { chooseAmbience(option.id); setAmbienceMenuOpen(false); ambienceTriggerRef.current?.focus(); }} onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const options = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='option']");
                const nextIndex = (index + (event.key === "ArrowDown" ? 1 : ambienceOptions.length - 1)) % ambienceOptions.length;
                options?.[nextIndex]?.focus();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setAmbienceMenuOpen(false);
                ambienceTriggerRef.current?.focus();
              }
            }}>{option.label}<small>{option.credit}</small></button>)}
          </div>}
          <small>{ambienceOptions.find((option) => option.id === ambienceTrack)?.credit}</small>
        </div>
        <div className={styles.ambienceActions}>
          <button type="button" className={styles.ambienceToggle} onClick={() => void toggleAmbience()} aria-label={ambiencePlaying ? "Pause café ambience" : "Play café ambience"} aria-pressed={ambiencePlaying}>
            <span aria-hidden="true">{ambiencePlaying ? "Ⅱ" : "▶"}</span><span>{ambiencePlaying ? "PAUSE" : "PLAY"}</span>
          </button>
          <label className={styles.ambienceVolume}>
            <span>VOL</span>
            <input type="range" min="0" max="1" step="0.01" value={ambienceVolume} onChange={(event) => setAmbienceVolume(Number(event.target.value))} aria-label="Ambience volume" />
          </label>
        </div>
        {ambienceError && <span className={styles.ambienceError} role="status">Audio could not be played</span>}
      </div>

      <aside className={styles.emojiPanel} aria-label="Room reactions">
        <span className={styles.emojiPanelTitle}>SEND A REACTION</span>
        <div className={styles.emojiButtons}>{reactionOptions.map((emoji) => <button key={emoji.id} type="button" onClick={() => sendReaction(emoji.id)} disabled={reactionCooldown || (backendConfigured ? !Object.values(occupants).some((occupant) => occupant.userId === userId) : localSeat === null)} aria-label={emoji.label} title={reactionCooldown ? "Please wait a moment before sending another reaction" : emoji.label}><Image src={emoji.src} alt="" width={38} height={38} /></button>)}</div>
      </aside>

      {availableSeats === 0
        ? <p className={styles.roomFullNotice} role="status" aria-live="polite">The room is full, please come back another time</p>
        : roomMessage && <p className={styles.roomMessage} role="status">{roomMessage}</p>}

      {welcomeNoticeOpen && <div className={styles.welcomeBackdrop}>
        <div className={`${styles.welcomeTreat} ${styles.welcomeDrink}`} aria-hidden="true">
          <svg viewBox="0 0 64 72">
            <path d="M17 25h30l-3 36H20z" fill="#f2dfbb" stroke="#67452d" strokeWidth="3" strokeLinejoin="round" />
            <path d="M47 31h5a8 8 0 0 1 0 16h-7" fill="none" stroke="#67452d" strokeWidth="3" />
            <path d="M23 18c-4-5 4-6 0-11m12 11c-4-5 4-6 0-11m12 11c-4-5 4-6 0-11" fill="none" stroke="#a8754e" strokeWidth="3" strokeLinecap="round" />
            <path d="M21 34h23" stroke="#a8754e" strokeWidth="4" strokeLinecap="round" />
            <path d="M23 55h19" stroke="#c18b5f" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div className={`${styles.welcomeTreat} ${styles.welcomePastry}`} aria-hidden="true">
          <svg viewBox="0 0 76 58">
            <path d="M10 40c2-16 13-27 28-27s26 11 28 27c-7 6-16 9-28 9S17 46 10 40Z" fill="#d5a15f" stroke="#67452d" strokeWidth="3" strokeLinejoin="round" />
            <path d="M22 39c1-10 7-18 16-21m0 22c1-12 6-20 14-22m-4 24c2-8 6-13 12-15" fill="none" stroke="#f2d69a" strokeWidth="4" strokeLinecap="round" />
            <path d="M18 45c11 5 29 6 41 0" fill="none" stroke="#a8754e" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <section className={styles.welcomeNotice} role="dialog" aria-modal="true" aria-labelledby="welcomeTitle" aria-describedby="welcomeDescription">
          <p className={styles.welcomeEyebrow}>WELCOME TO CAFE-VI</p>
          <h1 id="welcomeTitle">A cozy place to focus together.</h1>
          <p id="welcomeDescription">Cafe-Vi is a shared virtual café for focused work sessions. Pick a seat, set a task and timer, and settle in alongside other café guests.</p>
          <div className={styles.welcomeGuides}>
            <div>
              <div className={styles.welcomeGuideVisual}>
                <svg viewBox="0 0 48 48" aria-hidden="true">
                  <path d="M12 30h24v7H12zM16 30V19h16v11M15 37v4m18-4v4" />
                  <path d="M37 10v10m-5-5h10" />
                </svg>
                <span className={styles.welcomeNumber}>01</span>
              </div>
              <p><b>Claim a seat</b>Choose any open seat marked with a +. Sign in or create an account first, then enter your task and focus duration.</p>
            </div>
            <div>
              <div className={styles.welcomeGuideVisual}>
                <svg viewBox="0 0 48 48" aria-hidden="true">
                  <circle cx="24" cy="17" r="8" />
                  <path d="M9 41c1-8 7-13 15-13s14 5 15 13z" />
                  <circle cx="37" cy="11" r="6" />
                  <path d="m34.5 11 1.7 1.7 3.4-3.5" />
                </svg>
                <span className={styles.welcomeNumber}>02</span>
              </div>
              <p><b>Edit your profile</b>Use the profile icon in the upper-left corner to change your username or avatar. Sign in to save your profile.</p>
            </div>
            <div>
              <div className={styles.welcomeGuideVisual}>
                <svg viewBox="0 0 48 48" aria-hidden="true">
                  <circle cx="24" cy="25" r="16" />
                  <path d="M24 15v11l8 5M18 5h12M24 5v4" />
                  <path d="M36 9l3 3" />
                </svg>
                <span className={styles.welcomeNumber}>03</span>
              </div>
              <p><b>Focus together</b>Work on your own task, keep your session timer running, and enjoy the company of others in the room.</p>
            </div>
          </div>
          <button className={styles.welcomeDismiss} type="button" onClick={() => void dismissWelcomeNotice()} disabled={welcomeNoticeBusy} autoFocus>{welcomeNoticeBusy ? "SAVING..." : "LET'S GET STARTED"}</button>
        </section>
      </div>}

      {selected !== null && <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) void cancelSeatClaim(); }}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
          <button className={styles.close} onClick={() => void cancelSeatClaim()} aria-label="Close">×</button>
          <h2 id="dialogTitle">Task for this session</h2>
          <form onSubmit={(event) => void startSession(event)}>
            <label>Your name<input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} /></label>
            <label>What are you working on?<input autoFocus value={task} maxLength={80} placeholder="A small thing, a big thing…" onChange={(event) => setTask(event.target.value)} /></label>
            <div className={styles.dialogRow}>
              <div className={styles.durationControl}>
                <span>Focus time</span>
                <div className={styles.durationInputs}>
                  <label>Hours<input name="durationHours" type="number" inputMode="numeric" min="0" max="24" step="1" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
                  <span aria-hidden="true">:</span>
                  <label>Minutes<input name="durationMinutes" type="number" inputMode="numeric" min="0" max="59" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
                </div>
                <small>Whole numbers · leave either field blank to count it as 0</small>
              </div>
            </div>
            <button className={styles.startButton} type="submit" disabled={!name.trim() || !task.trim() || busy}>{busy ? "SAVING…" : "TAKE A SEAT"} <span>↗</span></button>
          </form>
          <p className={styles.smallNote}>{backendConfigured ? "Your seat and timer sync with everyone in the café." : "Local preview only — your session stays on this device."}</p>
        </section>
      </div>}
    </main>
  );
}
