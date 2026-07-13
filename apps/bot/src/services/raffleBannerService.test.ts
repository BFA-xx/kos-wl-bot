import assert from "node:assert/strict";
import test from "node:test";
import {
  durableRaffleBannerUrl,
  isDiscordAttachmentUrl,
} from "./raffleBannerService.js";

test("accepts only Discord attachment hosts and paths", () => {
  assert.equal(
    isDiscordAttachmentUrl(
      "https://cdn.discordapp.com/ephemeral-attachments/1/2/banner.png?ex=1",
    ),
    true,
  );
  assert.equal(
    isDiscordAttachmentUrl(
      "https://media.discordapp.net/attachments/1/2/banner.webp",
    ),
    true,
  );
  assert.equal(
    isDiscordAttachmentUrl("https://cdn.discordapp.com/icons/1/logo.png"),
    false,
  );
  assert.equal(
    isDiscordAttachmentUrl(
      "https://cdn.discordapp.com.evil.example/attachments/1/banner.png",
    ),
    false,
  );
});

test("builds a versioned public banner URL", () => {
  assert.equal(
    durableRaffleBannerUrl("https://raffle.koslabs.app/", 61, 1234),
    "https://raffle.koslabs.app/r/61/banner?v=1234",
  );
});
