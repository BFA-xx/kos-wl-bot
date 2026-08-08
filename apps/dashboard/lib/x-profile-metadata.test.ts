import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchXProfileMetadata } from "./x-profile-metadata";

describe("fetchXProfileMetadata", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extracts public X profile branding and canonical identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`
          <meta property="profile:first_name" content="Assembly &amp; Co">
          <meta property="profile:username" content="theassembly">
          <meta name="description" content="We make noise.">
          <meta property="og:image" content="https://pbs.twimg.com/profile_images/1/avatar_200x200.png">
          <div itemType="https://schema.org/Person">
            <meta itemProp="sameAs" content="https://assembly.example/">
            <a href="/theassembly/header_photo"><img src="https://pbs.twimg.com/profile_banners/1/2/1500x500"></a>
          </div>
          <script>is_blue_verified:!0</script>
        `),
      ),
    );

    await expect(
      fetchXProfileMetadata("https://x.com/TheAssembly"),
    ).resolves.toEqual({
      displayName: "Assembly & Co",
      username: "theassembly",
      avatarUrl: "https://pbs.twimg.com/profile_images/1/avatar_400x400.png",
      bannerUrl: "https://pbs.twimg.com/profile_banners/1/2/1500x500",
      bio: "We make noise.",
      websiteUrl: "https://assembly.example/",
      verified: true,
      profileUrl: "https://x.com/theassembly",
    });
  });

  it("rejects non-profile input before making a request", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(
      fetchXProfileMetadata("https://example.com/not-x"),
    ).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
