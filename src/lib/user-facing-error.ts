type ErrorWithMessage = { message?: unknown };

export function userFacingError(error: unknown, fallback = "Something went wrong. Please try again.") {
  const message = typeof error === "string"
    ? error
    : error && typeof error === "object" && "message" in error
      ? String((error as ErrorWithMessage).message ?? "")
      : error instanceof Error
        ? error.message
        : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("get_monthly_activity") && (normalized.includes("pgrst202") || normalized.includes("schema cache") || normalized.includes("could not find the function"))) {
    return "The monthly activity calendar hasn't been set up in this Supabase project yet. Apply the profile activity migration, then reload.";
  }
  if (normalized.includes("diary_entries") && (normalized.includes("pgrst205") || normalized.includes("42p01") || normalized.includes("does not exist"))) {
    return "The diary and activity tables haven't been set up in this Supabase project yet. Apply the profile activity migration, then reload.";
  }
  if (normalized.includes("chat_messages") && (normalized.includes("pgrst205") || normalized.includes("42p01") || normalized.includes("schema cache") || normalized.includes("does not exist"))) {
    return "Live chat hasn't been set up in this Supabase project yet. Apply the chat migration, then reload.";
  }
  if (normalized.includes("chat_moderators") && (normalized.includes("pgrst205") || normalized.includes("42p01") || normalized.includes("schema cache") || normalized.includes("does not exist"))) {
    return "Chat moderation hasn't been set up in this Supabase project yet. Apply the chat moderators migration, then reload.";
  }
  if (normalized.includes("already_seated")) return "You're already at a table. Leave your current seat before choosing another.";
  if (normalized.includes("seat_unavailable")) return "That seat was just taken. Please choose another open seat.";
  if (normalized.includes("authentication_required") || normalized.includes("jwt expired") || normalized.includes("auth session missing")) {
    return "Sign in or make an account to claim a seat!";
  }
  if (normalized.includes("seat_required")) return "Choose an open seat before starting a task.";
  if (normalized.includes("session_already_active")) return "You already have a task in progress.";
  if (normalized.includes("invalid_session_duration")) return "The café couldn't accept that duration. The timer accepts 1 minute through 24 hours.";
  if (normalized.includes("invalid_task_name")) return "Enter a task name between 1 and 80 characters.";
  if (normalized.includes("invalid_seat_number")) return "That seat isn't available. Please choose another.";
  if (normalized.includes("invalid login credentials")) return "That email and password don't match. Please try again.";
  if (normalized.includes("email not confirmed")) return "Please confirm your email before signing in.";
  if (normalized.includes("user already registered")) return "An account already exists with that email. Try signing in instead.";
  if (normalized.includes("password") && (normalized.includes("short") || normalized.includes("characters"))) {
    return "Use a password with at least 8 characters.";
  }
  if (normalized.includes("invalid email")) return "Enter a valid email address.";
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) return "Too many attempts. Please wait a little and try again.";
  if (normalized.includes("failed to fetch") || normalized.includes("network") || normalized.includes("timeout")) {
    return "We couldn't connect. Check your internet connection and try again.";
  }

  return fallback;
}
