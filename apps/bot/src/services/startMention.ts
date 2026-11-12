import { RaffleStatus } from "@kos/db";

/**
 * The text shown ABOVE the raffle embed while it's live.
 *
 * Discord's push notification for a ping shows only this text, not the
 * embed, so it has to name the raffle: a bare "@everyone" left members with a
 * notification that said nothing about what had started.
 * Empty unless the raffle is live and pings are on.
 * Note: Discord only push-notifies on message *create*, so an instant ("now")
 * raffle pings on post; a scheduled one is re-posted when it flips live.
 */
export function startMentionContent(raffle: {
  status: RaffleStatus;
  startPing: string;
  projectName: string;
  title: string;
}): string {
  if (raffle.status !== RaffleStatus.LIVE || raffle.startPing === "none")
    return "";
  const mention = raffle.startPing === "here" ? "@here" : "@everyone";
  // The raffle name leads so it is what the notification preview shows first.
  return `🎟️ **${raffleName(raffle)}** raffle is live! ${mention}`;
}

function raffleName(raffle: { projectName: string; title: string }): string {
  const project = raffle.projectName.trim();
  const title = raffle.title.trim();
  if (!title) return project;
  if (!project || title.toLowerCase().includes(project.toLowerCase()))
    return title;
  return `${project} — ${title}`;
}
