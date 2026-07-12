import { expect, test } from "@playwright/test";

const orgSlug = process.env.KOS_E2E_ORG_SLUG || "kos";

test.describe("authenticated community experience", () => {
  test("separates joined communities from the full directory", async ({
    page,
  }) => {
    await page.goto("/me/communities?view=mine", { waitUntil: "networkidle" });

    await expect(page).toHaveURL(/\/me\/communities\?view=mine$/u);
    await expect(
      page.getByRole("heading", { name: "Communities" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Your communities/u }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByText("Reconnect Discord to load your communities"),
    ).toHaveCount(0);
    await expect(page.getByTestId("community-card").first()).toBeVisible();
    await expect(
      page.getByText("Joined", { exact: true }).first(),
    ).toBeVisible();

    await expect(page.getByTestId("communities-directory")).toHaveScreenshot(
      "communities-mine.png",
      {
        maskColor: "#27272a",
        mask: [
          page.getByTestId("communities-metrics"),
          page.getByTestId("community-live-status"),
          page.locator("img"),
        ],
      },
    );

    await page.getByRole("link", { name: /Discover all/u }).click();
    await expect(page).toHaveURL(/\/me\/communities\?view=all$/u);
    await expect(
      page.getByRole("link", { name: /Discover all/u }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("community-card").first()).toBeVisible();

    await expect(page.getByTestId("communities-directory")).toHaveScreenshot(
      "communities-all.png",
      {
        maskColor: "#27272a",
        mask: [
          page.getByTestId("communities-metrics"),
          page.getByTestId("community-live-status"),
          page.locator("img"),
        ],
      },
    );
  });

  test("keeps community X branding accessible and responsive", async ({
    page,
  }) => {
    await page.goto(`/${orgSlug}/settings`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("branding-form")).toBeVisible();
    await expect(page.getByLabel("Community X profile")).toBeVisible();

    await expect(page.getByTestId("branding-form")).toHaveScreenshot(
      "community-branding.png",
      {
        maskColor: "#27272a",
        mask: [
          page.getByTestId("branding-form").locator("input"),
          page.getByTestId("branding-form").locator("textarea"),
          page.getByTestId("branding-form").locator("img"),
        ],
      },
    );
  });
});
