import { expect, test, type Page } from "@playwright/test";

const orgSlug = process.env.KOS_E2E_ORG_SLUG || "kos";
const bannerUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#2563eb" />
        <stop offset="1" stop-color="#7c3aed" />
      </linearGradient>
    </defs>
    <rect width="1200" height="420" fill="#09090b" />
    <circle cx="1030" cy="40" r="310" fill="#2563eb" opacity=".28" />
    <rect x="46" y="46" width="1108" height="328" rx="34" fill="url(#bg)" opacity=".9" />
    <text x="92" y="224" fill="white" font-family="Arial, sans-serif" font-size="92" font-weight="700">KOS PARTNER DROP</text>
    <text x="98" y="285" fill="white" opacity=".76" font-family="Arial, sans-serif" font-size="31">Verified community access</text>
  </svg>
`)}`;

const memberRaffles = {
  xLinked: true,
  taskGroups: [],
  raffles: [
    {
      id: 910001,
      org: { slug: orgSlug, name: "KOS", logoUrl: null },
      projectName: "MukuroNFT",
      title: "GTD",
      description:
        "A verified partner drop for community members building on Robinhood Chain.",
      status: "LIVE",
      endAt: "2026-07-20T20:00:00.000Z",
      spots: 30,
      entryCount: 18,
      bannerUrl,
      entered: true,
      tasks: [
        {
          id: "fixture-follow",
          kind: "SOCIAL",
          source: "RAFFLE",
          type: "VISIT_LINK",
          typeLabel: "Visit link",
          title: "Follow @MukuroNFT",
          description: "Open the project profile, then confirm this step.",
          required: true,
          points: 0,
          actionUrl: "https://example.com/mukuro",
          status: "VERIFIED",
          verifiable: true,
          requiresClick: true,
          clicked: true,
        },
        {
          id: "fixture-engage",
          kind: "SOCIAL",
          source: "RAFFLE",
          type: "VISIT_LINK",
          typeLabel: "Visit link",
          title: "Like and repost",
          description: "Open the campaign post before verifying.",
          required: true,
          points: 0,
          actionUrl: "https://example.com/mukuro/post",
          status: "CLICKED",
          verifiable: true,
          requiresClick: true,
          clicked: true,
        },
      ],
    },
  ],
  endedRaffles: [
    {
      id: 910002,
      org: { slug: orgSlug, name: "KOS", logoUrl: null },
      projectName: "Pixroll",
      title: "FCFS",
      description: "A completed partner raffle retained for member history.",
      status: "ENDED",
      endAt: "2026-07-10T18:30:00.000Z",
      spots: 12,
      entryCount: 74,
      bannerUrl,
      entered: false,
      tasks: [
        {
          id: "fixture-ended-follow",
          kind: "SOCIAL",
          source: "RAFFLE",
          type: "VISIT_LINK",
          typeLabel: "Visit link",
          title: "Follow @Pixroll_nft",
          description: "The original project-follow requirement.",
          required: true,
          points: 0,
          actionUrl: "https://example.com/pixroll",
          status: "VERIFIED",
          verifiable: true,
          requiresClick: true,
          clicked: true,
        },
      ],
    },
  ],
};

const memberEntry = {
  status: "LIVE",
  entered: true,
  canEnter: true,
  discordOnly: false,
  gates: [],
  entryCount: 18,
  spots: 30,
};

function collaboration(
  id: string,
  projectName: string,
  status: string,
  priority: string,
  allocation: number,
  collected: number,
) {
  return {
    id,
    projectName,
    status,
    priority,
    submissionStatus: status === "COMPLETED" ? "SUBMITTED" : "NOT_STARTED",
    whitelistAllocation: allocation,
    ownerId: "team-1",
    assignedToId: "team-1",
    reviewerId: null,
    hostAt: "2026-07-12T12:00:00.000Z",
    hostingDeadline: null,
    walletSubmissionDeadline: "2026-07-18T18:00:00.000Z",
    collaborationDeadline: null,
    followUpAt: null,
    updatedAt: "2026-07-15T08:00:00.000Z",
    partner: {
      id: `partner-${id}`,
      name: projectName,
      logoUrl: null,
      websiteUrl: `https://example.com/${id}`,
      discordUrl: null,
      xUrl: `https://x.com/${projectName.toLowerCase()}`,
      chain: "RH",
      category: "NFT",
      trustRating: 5,
    },
    tags: [
      { tag: { id: `tag-${id}`, name: "Raffle partner", color: "#3B82F6" } },
    ],
    raffles: [
      {
        raffle: {
          id: Number(id.replace(/\D/gu, "")) + 920000,
          projectName,
          status: status === "COMPLETED" ? "ENDED" : "LIVE",
          title: status === "COMPLETED" ? "FCFS" : "GTD",
          bannerUrl,
          endAt: "2026-07-20T20:00:00.000Z",
          walletChains: ["RH", "EVM"],
        },
      },
    ],
    reminders: [],
    walletProgress: {
      total: allocation,
      collected,
      submitted: status === "COMPLETED" ? allocation : 0,
      rejected: 0,
      remaining: Math.max(0, allocation - collected),
      percent: allocation ? Math.round((collected / allocation) * 100) : 0,
    },
  };
}

const collabHub = {
  collaborations: [
    collaboration("collab-1", "MukuroNFT", "LEAD", "HIGH", 30, 8),
    collaboration("collab-2", "Pixroll", "COMPLETED", "MEDIUM", 12, 12),
    collaboration("collab-3", "NUTSY", "COLLECTING_WALLETS", "URGENT", 20, 14),
  ],
  summary: {
    active: 2,
    hostingToday: 1,
    waitingForWallets: 1,
    readyForSubmission: 0,
    completedAllTime: 34,
    totalWlSpots: 286,
    linkedRafflesAllTime: 59,
    unlinkedRaffles: 0,
  },
  team: [
    {
      id: "team-1",
      name: "KOS Admin",
      avatarUrl: null,
      role: "ADMIN",
    },
  ],
  tags: [{ id: "partner", name: "Raffle partner", color: "#3B82F6" }],
  savedFilters: [],
  recentActivity: [],
  recentNotes: [],
  reminders: [],
  analytics: {
    total: 34,
    successRate: 88,
    averageCompletionDays: 4,
    wlCollected: 286,
    wlHosted: 248,
    pendingSubmissions: 1,
    topPartners: [
      { name: "MukuroNFT", count: 3 },
      { name: "Pixroll", count: 2 },
    ],
    topTeamMembers: [{ id: "team-1", name: "KOS Admin", count: 34 }],
    activityHistory: [
      { key: "2026-05", label: "May", value: 8 },
      { key: "2026-06", label: "Jun", value: 19 },
      { key: "2026-07", label: "Jul", value: 7 },
    ],
  },
};

async function fulfillJson(page: Page, pattern: string, body: unknown) {
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

async function keepStickyShellFromCoveringWorkspace(page: Page) {
  await page.addStyleTag({
    content: "header.sticky { display: none !important; }",
  });
  await expect(page.locator("header.sticky")).toBeHidden();
}

test.describe("authenticated member and collaboration workspaces", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((slug) => {
      window.localStorage.setItem("kos-theme", "dark");
      window.localStorage.setItem(`kos-collab-view:${slug}`, "BOARD");
    }, orgSlug);
    await fulfillJson(page, "**/api/me/notifications", {
      items: [],
      unread: 0,
    });
  });

  test("keeps member raffles clear across desktop and mobile", async ({
    page,
  }) => {
    await fulfillJson(page, "**/api/me/tasks", memberRaffles);
    await fulfillJson(page, "**/api/me/raffles/910001", memberEntry);

    await page.goto("/me/raffles", { waitUntil: "networkidle" });

    await expect(page).toHaveURL(/\/me\/raffles$/u);
    await expect(
      page.getByRole("heading", { name: "Raffles", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("MukuroNFT", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("You're entered ✓")).toBeVisible();
    await expect(
      page.getByText("Ended raffles", { exact: true }),
    ).toBeVisible();
    await keepStickyShellFromCoveringWorkspace(page);

    await expect(page.getByTestId("member-raffles-workspace")).toHaveScreenshot(
      "member-raffles.png",
    );
  });

  test("keeps the Collab Hub usable across desktop and mobile", async ({
    page,
  }) => {
    await fulfillJson(page, `**/api/${orgSlug}/collaborations?**`, collabHub);

    await page.goto(`/${orgSlug}/collabs`, { waitUntil: "networkidle" });

    await expect(page).toHaveURL(new RegExp(`/${orgSlug}/collabs$`, "u"));
    await expect(
      page.getByRole("heading", { name: "Collab Hub" }),
    ).toBeVisible();
    await expect(page.getByText("Pipeline workspace")).toBeVisible();
    const workspace = page.getByTestId("collab-hub-workspace");
    await expect(workspace).toContainText("MukuroNFT");
    await expect(workspace).toContainText("Completed");
    await keepStickyShellFromCoveringWorkspace(page);

    await expect(workspace).toHaveScreenshot("collab-hub.png");
  });
});
