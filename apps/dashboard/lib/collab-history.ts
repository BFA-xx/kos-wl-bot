export interface HistoricalRaffleTask {
  title?: string | null;
  type?: string | null;
  config?: unknown;
}

export interface HistoricalRaffle {
  id: number;
  projectName: string;
  title: string;
  status: string;
  spots: number;
  entryCount: number;
  startAt: Date | string;
  endAt: Date | string;
  endedAt?: Date | string | null;
  bannerUrl?: string | null;
  externalUrl?: string | null;
  requirements?: unknown;
  tasks?: HistoricalRaffleTask[];
}

export type HistoricalRaffleVariant = "GTD" | "FCFS" | "WL";

export interface HistoricalCollaborationGroup {
  key: string;
  projectName: string;
  normalizedName: string;
  raffleIds: number[];
  variants: HistoricalRaffleVariant[];
  whitelistAllocation: number;
  hostAt: Date;
  completedAt: Date;
  requirements: string;
  xUrl: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
}

const RESERVED_X_PATHS = new Set([
  "home",
  "i",
  "intent",
  "search",
  "share",
  "status",
]);

const asDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function legacyTasks(requirements: unknown): HistoricalRaffleTask[] {
  const record = asRecord(requirements);
  if (!record || !Array.isArray(record.tasks)) return [];
  return record.tasks.map((item) => {
    const task = asRecord(item);
    return {
      title: typeof task?.label === "string" ? task.label.trim() || null : null,
      config:
        typeof task?.url === "string" ? { url: task.url.trim() } : undefined,
    };
  });
}

function taskStrings(raffle: HistoricalRaffle): string[] {
  const values: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const text = value.trim();
      if (text) values.push(text);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = asRecord(value);
    if (record) Object.values(record).forEach(visit);
  };
  for (const task of [
    ...legacyTasks(raffle.requirements),
    ...(raffle.tasks ?? []),
  ]) {
    visit(task.title);
    visit(task.config);
  }
  return values;
}

export function cleanHistoricalProjectName(value: string): string {
  return (
    value
      .trim()
      .replace(/^kos\s*[x×]\s*/i, "")
      .replace(/[\s,;:!?._-]+$/g, "")
      .replace(/\s+/g, " ") || "Untitled partner"
  );
}

export function historicalProjectKey(value: string): string {
  const compact = cleanHistoricalProjectName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return compact.length > 4 ? compact.replace(/nft$/, "") : compact;
}

export function historicalRaffleVariant(
  raffle: Pick<HistoricalRaffle, "projectName" | "title">,
): HistoricalRaffleVariant {
  const label = `${raffle.projectName} ${raffle.title}`.toLowerCase();
  if (/\bfcfs\b/.test(label)) return "FCFS";
  if (/\bgtds?\b/.test(label)) return "GTD";
  return "WL";
}

export function isImportableHistoricalRaffle(
  raffle: HistoricalRaffle,
): boolean {
  if (raffle.status !== "ENDED" || raffle.entryCount < 1) return false;
  return !/\btests?(?:y|ing)?\b/i.test(`${raffle.projectName} ${raffle.title}`);
}

export function extractHistoricalXHandles(raffle: HistoricalRaffle): string[] {
  const handles: string[] = [];
  const add = (value: string | null | undefined) => {
    const handle = value?.replace(/^@/, "").trim().toLowerCase();
    if (
      handle &&
      /^[a-z0-9_]{1,15}$/.test(handle) &&
      !RESERVED_X_PATHS.has(handle) &&
      !handles.includes(handle)
    ) {
      handles.push(handle);
    }
  };

  for (const value of taskStrings(raffle)) {
    const screenName = value.match(/[?&]screen_name=([a-z0-9_]{1,15})/i);
    add(screenName?.[1]);
    for (const match of value.matchAll(
      /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([a-z0-9_]{1,15})/gi,
    )) {
      add(match[1]);
    }
    for (const match of value.matchAll(/@([a-z0-9_]{1,15})/gi)) {
      add(match[1]);
    }
  }
  return handles;
}

function normalizePartnerName(value: string): string {
  return cleanHistoricalProjectName(value)
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function uniqueLabels(raffles: HistoricalRaffle[]): string[] {
  const labels = new Map<string, string>();
  for (const raffle of raffles) {
    for (const task of [
      ...legacyTasks(raffle.requirements),
      ...(raffle.tasks ?? []),
    ]) {
      const value = task.title?.trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase().replace(/\s+/g, " ");
      if (!labels.has(key)) labels.set(key, value);
    }
  }
  return [...labels.values()].slice(0, 24);
}

export function groupHistoricalRaffles(
  input: HistoricalRaffle[],
): HistoricalCollaborationGroup[] {
  const raffles = input.filter(isImportableHistoricalRaffle);
  const parents = raffles.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!;
      index = parents[index]!;
    }
    return index;
  };
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parents[b] = a;
  };

  const byProject = new Map<string, number>();
  raffles.forEach((raffle, index) => {
    const key = historicalProjectKey(raffle.projectName);
    const previous = byProject.get(key);
    if (previous === undefined) byProject.set(key, index);
    else union(previous, index);
  });

  const handleIndexes = new Map<string, number[]>();
  raffles.forEach((raffle, index) => {
    for (const handle of extractHistoricalXHandles(raffle)) {
      const indexes = handleIndexes.get(handle) ?? [];
      indexes.push(index);
      handleIndexes.set(handle, indexes);
    }
  });
  for (const indexes of handleIndexes.values()) {
    const projectKeys = new Set(
      indexes.map((index) => historicalProjectKey(raffles[index]!.projectName)),
    );
    // A community's own X account can appear in many unrelated raffles. Social
    // identity is only used to bridge two naming variants of one partner.
    if (projectKeys.size > 2) continue;
    indexes.slice(1).forEach((index) => union(indexes[0]!, index));
  }

  const grouped = new Map<number, HistoricalRaffle[]>();
  raffles.forEach((raffle, index) => {
    const root = find(index);
    const values = grouped.get(root) ?? [];
    values.push(raffle);
    grouped.set(root, values);
  });

  return [...grouped.values()]
    .map((group): HistoricalCollaborationGroup => {
      const ordered = [...group].sort(
        (a, b) => asDate(a.endAt).getTime() - asDate(b.endAt).getTime(),
      );
      const nameCounts = new Map<string, { name: string; count: number }>();
      for (const raffle of ordered) {
        const name = cleanHistoricalProjectName(raffle.projectName);
        const key = normalizePartnerName(name);
        const current = nameCounts.get(key) ?? { name, count: 0 };
        nameCounts.set(key, { name, count: current.count + 1 });
      }
      const projectName = [...nameCounts.values()].reduce((best, current) =>
        current.count >= best.count ? current : best,
      ).name;
      const detectedVariants = [
        ...new Set(ordered.map(historicalRaffleVariant)),
      ];
      // Older dashboard raffles did not store a formal GTD/FCFS type. A
      // same-project record paired with an explicit FCFS round was the GTD
      // side unless its title said otherwise.
      const variants = [
        ...new Set(
          detectedVariants.map((variant) =>
            variant === "WL" && detectedVariants.includes("FCFS")
              ? "GTD"
              : variant,
          ),
        ),
      ].sort(
        (a, b) =>
          ["GTD", "FCFS", "WL"].indexOf(a) - ["GTD", "FCFS", "WL"].indexOf(b),
      );
      const handleCounts = new Map<string, number>();
      for (const raffle of ordered) {
        for (const handle of extractHistoricalXHandles(raffle)) {
          handleCounts.set(handle, (handleCounts.get(handle) ?? 0) + 1);
        }
      }
      const primaryHandle = [...handleCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];
      const labels = uniqueLabels(ordered);
      const raffleSummary = ordered
        .map(
          (raffle) =>
            `#${raffle.id} ${historicalRaffleVariant(raffle)} (${raffle.spots} spots)`,
        )
        .join(", ");
      const requirements = [
        `Imported raffle history: ${raffleSummary}.`,
        labels.length ? `Social tasks: ${labels.join(" · ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const latestWithBanner = [...ordered]
        .reverse()
        .find((raffle) => raffle.bannerUrl?.trim());
      const latestWithWebsite = [...ordered]
        .reverse()
        .find((raffle) => raffle.externalUrl?.trim());
      const completedAt = ordered.reduce(
        (latest, raffle) => {
          const value = asDate(raffle.endedAt ?? raffle.endAt);
          return value > latest ? value : latest;
        },
        asDate(ordered[0]!.endedAt ?? ordered[0]!.endAt),
      );

      return {
        key: historicalProjectKey(projectName),
        projectName,
        normalizedName: normalizePartnerName(projectName),
        raffleIds: ordered.map((raffle) => raffle.id),
        variants,
        whitelistAllocation: ordered.reduce(
          (total, raffle) => total + Math.max(0, raffle.spots),
          0,
        ),
        hostAt: ordered.reduce((earliest, raffle) => {
          const value = asDate(raffle.startAt);
          return value < earliest ? value : earliest;
        }, asDate(ordered[0]!.startAt)),
        completedAt,
        requirements,
        xUrl: primaryHandle ? `https://x.com/${primaryHandle}` : null,
        logoUrl: latestWithBanner?.bannerUrl?.trim() || null,
        websiteUrl: latestWithWebsite?.externalUrl?.trim() || null,
      };
    })
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
}
