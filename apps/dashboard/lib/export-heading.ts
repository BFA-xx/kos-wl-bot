/**
 * The "{community} X {project}" heading on exported winner lists.
 *
 * Every organization exports under its own name, so a PRX raffle reads
 * "PRX X VOLTOADS", not "KOS X VOLTOADS".
 */
export function exportHeading(
  communityName: string,
  projectName: string,
): string {
  const community = communityName.trim() || "KOS";
  return `${community} X ${projectName.trim()}`;
}

/** Lowercase, dash-separated form for download filenames. */
export function filenamePart(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
