import { telegramConfig } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { title: string; body: string; ok?: boolean }> = {
  linked: {
    title: "X account connected",
    body: "Head back to Telegram and tap Check follow to finish onboarding.",
    ok: true,
  },
  not_configured: {
    title: "X linking isn't set up yet",
    body: "Ask the KOS team — the bot is missing its X credentials.",
  },
  invalid_link: { title: "That link is incomplete", body: "Open the link from Telegram again." },
  expired_link: {
    title: "That link has expired",
    body: "Links last 10 minutes and work once. Tap Connect X in Telegram for a fresh one.",
  },
  invalid_state: {
    title: "The sign-in didn't complete",
    body: "Start again from Telegram. If your browser blocks cookies, try the default browser.",
  },
  token_exchange_failed: { title: "X rejected the sign-in", body: "Try again from Telegram." },
  profile_fetch_failed: { title: "Couldn't read your X profile", body: "Try again from Telegram." },
  already_linked_elsewhere: {
    title: "That X account is already in use",
    body: "It's connected to a different KOS member. Use your own X account, or contact the team.",
  },
};

/** Where the X OAuth round-trip lands a Telegram member. */
export default function TelegramXConnectPage({
  searchParams,
}: {
  searchParams: { x?: string };
}) {
  const state = MESSAGES[searchParams.x ?? ""] ?? {
    title: "Connect X from Telegram",
    body: "Open the KOS bot and tap Connect X to start.",
  };
  const { botUsername } = telegramConfig();

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div
        className={`text-3xl ${state.ok ? "text-emerald-400" : "text-amber-400"}`}
        aria-hidden
      >
        {state.ok ? "✓" : "!"}
      </div>
      <h1 className="text-xl font-semibold">{state.title}</h1>
      <p className="text-sm text-kos-muted">{state.body}</p>
      {botUsername && (
        <a
          className="rounded-lg bg-kos-accent px-4 py-2 text-sm font-medium text-black"
          href={`https://t.me/${botUsername}`}
        >
          Back to Telegram
        </a>
      )}
    </main>
  );
}
