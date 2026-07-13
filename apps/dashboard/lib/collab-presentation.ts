const GENERIC_PARTNER_CATEGORIES = new Set([
  "partner",
  "raffle partner",
  "collaboration partner",
]);

export function meaningfulPartnerCategory(value: string | null | undefined) {
  const category = value?.trim() ?? "";
  return category && !GENERIC_PARTNER_CATEGORIES.has(category.toLowerCase())
    ? category
    : null;
}

export function partnerDescriptor({
  chain,
  category,
}: {
  chain?: string | null;
  category?: string | null;
}) {
  return [chain?.trim() || null, meaningfulPartnerCategory(category)]
    .filter(Boolean)
    .join(" · ");
}

export function buildAllTimeActivityHistory(
  rows: { createdAt: Date }[],
  now = new Date(),
) {
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const earliest = rows.reduce(
    (value, row) => (row.createdAt < value ? row.createdAt : value),
    now,
  );
  const start = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  const monthCount = Math.max(
    1,
    (currentMonth.getFullYear() - start.getFullYear()) * 12 +
      currentMonth.getMonth() -
      start.getMonth() +
      1,
  );

  return Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en", {
        month: "short",
        year: "2-digit",
      }),
      value: rows.filter((row) => row.createdAt >= date && row.createdAt < next)
        .length,
    };
  });
}
