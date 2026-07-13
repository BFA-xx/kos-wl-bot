/**
 * Canonical permission model for organizations.
 *
 * Pure data + a pure check function (no Prisma import) so it can be used in
 * server routes, client components, and — later — the bot. Roles are stored in
 * the DB as `OrganizationRole.permissions: string[]`; these are the strings.
 */

export const PERMISSIONS = {
  RAFFLE_CREATE: "raffle:create",
  RAFFLE_EDIT: "raffle:edit",
  RAFFLE_DELETE: "raffle:delete",
  RAFFLE_REROLL: "raffle:reroll",
  RAFFLE_END: "raffle:end",
  COLLAB_VIEW: "collab:view",
  COLLAB_CREATE: "collab:create",
  COLLAB_EDIT: "collab:edit",
  COLLAB_ASSIGN: "collab:assign",
  COLLAB_EXPORT: "collab:export",
  COLLAB_ARCHIVE: "collab:archive",
  PARTICIPANT_VIEW: "participant:view",
  WALLET_VIEW: "wallet:view",
  WALLET_EXPORT: "wallet:export",
  ANALYTICS_VIEW: "analytics:view",
  REPORT_VIEW: "report:view",
  REPORT_EXPORT: "report:export",
  MEMBER_MANAGE: "member:manage",
  BRANDING_EDIT: "branding:edit",
  SETTINGS_EDIT: "settings:edit",
  BILLING_MANAGE: "billing:manage",
  GUILD_CONNECT: "guild:connect",
  ORG_TRANSFER: "org:transfer",
  ORG_DELETE: "org:delete",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Human-friendly labels + grouping, used by the Team / Roles UI. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "raffle:create": "Create raffles",
  "raffle:edit": "Edit raffles",
  "raffle:delete": "Delete raffles",
  "raffle:reroll": "Reroll winners",
  "raffle:end": "End raffles",
  "collab:view": "View collaborations",
  "collab:create": "Create collaborations",
  "collab:edit": "Edit collaborations",
  "collab:assign": "Assign collaborations",
  "collab:export": "Export collaboration wallets",
  "collab:archive": "Archive collaborations",
  "participant:view": "View participants",
  "wallet:view": "View wallets",
  "wallet:export": "Export wallets",
  "analytics:view": "View analytics",
  "report:view": "View reports",
  "report:export": "Export reports",
  "member:manage": "Manage members",
  "branding:edit": "Edit branding",
  "settings:edit": "Edit settings",
  "billing:manage": "Manage billing",
  "guild:connect": "Connect Discord servers",
  "org:transfer": "Transfer ownership",
  "org:delete": "Delete organization",
};

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] =
  [
    {
      label: "Collab Hub",
      permissions: [
        PERMISSIONS.COLLAB_VIEW,
        PERMISSIONS.COLLAB_CREATE,
        PERMISSIONS.COLLAB_EDIT,
        PERMISSIONS.COLLAB_ASSIGN,
        PERMISSIONS.COLLAB_EXPORT,
        PERMISSIONS.COLLAB_ARCHIVE,
      ],
    },
    {
      label: "Raffles",
      permissions: [
        PERMISSIONS.RAFFLE_CREATE,
        PERMISSIONS.RAFFLE_EDIT,
        PERMISSIONS.RAFFLE_DELETE,
        PERMISSIONS.RAFFLE_REROLL,
        PERMISSIONS.RAFFLE_END,
      ],
    },
    {
      label: "Data",
      permissions: [
        PERMISSIONS.PARTICIPANT_VIEW,
        PERMISSIONS.WALLET_VIEW,
        PERMISSIONS.WALLET_EXPORT,
        PERMISSIONS.ANALYTICS_VIEW,
        PERMISSIONS.REPORT_VIEW,
        PERMISSIONS.REPORT_EXPORT,
      ],
    },
    {
      label: "Organization",
      permissions: [
        PERMISSIONS.MEMBER_MANAGE,
        PERMISSIONS.BRANDING_EDIT,
        PERMISSIONS.SETTINGS_EDIT,
        PERMISSIONS.BILLING_MANAGE,
        PERMISSIONS.GUILD_CONNECT,
        PERMISSIONS.ORG_TRANSFER,
        PERMISSIONS.ORG_DELETE,
      ],
    },
  ];

const P = PERMISSIONS;

/** Built-in system roles seeded for every organization. */
export const BUILTIN_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: "Owner", permissions: ALL_PERMISSIONS },
  {
    name: "Admin",
    permissions: ALL_PERMISSIONS.filter(
      (p) => p !== P.ORG_TRANSFER && p !== P.ORG_DELETE,
    ),
  },
  {
    name: "Moderator",
    permissions: [
      P.RAFFLE_CREATE,
      P.RAFFLE_EDIT,
      P.RAFFLE_REROLL,
      P.RAFFLE_END,
      P.PARTICIPANT_VIEW,
      P.WALLET_VIEW,
      P.ANALYTICS_VIEW,
      P.REPORT_VIEW,
      P.REPORT_EXPORT,
      P.COLLAB_VIEW,
      P.COLLAB_EDIT,
    ],
  },
  {
    name: "Collab Manager",
    permissions: [
      P.COLLAB_VIEW,
      P.COLLAB_CREATE,
      P.COLLAB_EDIT,
      P.COLLAB_ASSIGN,
      P.COLLAB_EXPORT,
      P.COLLAB_ARCHIVE,
      P.RAFFLE_CREATE,
      P.RAFFLE_EDIT,
      P.PARTICIPANT_VIEW,
      P.ANALYTICS_VIEW,
      P.REPORT_VIEW,
    ],
  },
  {
    name: "Viewer",
    permissions: [
      P.COLLAB_VIEW,
      P.PARTICIPANT_VIEW,
      P.WALLET_VIEW,
      P.ANALYTICS_VIEW,
      P.REPORT_VIEW,
    ],
  },
];

/** The default role assigned to newly-invited members. */
export const DEFAULT_MEMBER_ROLE = "Viewer";
export const OWNER_ROLE = "Owner";

/**
 * The single authorization check. The organization owner always passes (their
 * membership isn't required to hold every permission string).
 */
export function hasPermission(
  ctx: { isOwner: boolean; permissions: string[] },
  permission: Permission,
): boolean {
  if (ctx.isOwner) return true;
  return ctx.permissions.includes(permission);
}
