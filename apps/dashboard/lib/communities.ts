export function communityHasGuildMembership(
  guildConnections: { guildId: string }[],
  memberGuildIds: ReadonlySet<string>,
): boolean {
  return guildConnections.some((connection) =>
    memberGuildIds.has(connection.guildId),
  );
}
