import { describe, expect, it } from "vitest";
import { DRIVE_FILE_SCOPE, grantsDriveAccess } from "./google";

describe("grantsDriveAccess", () => {
  it("accepts a grant carrying the file scope", () => {
    expect(
      grantsDriveAccess(
        `${DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/userinfo.email openid`,
      ),
    ).toBe(true);
  });

  it("rejects the sign-in-only grant Google returns when the box is unticked", () => {
    // Exactly what came back in production on 2026-09-05: the account read as
    // "connected" while being unable to create a single file.
    expect(
      grantsDriveAccess(
        "https://www.googleapis.com/auth/userinfo.email openid",
      ),
    ).toBe(false);
  });

  it("rejects a missing or empty scope", () => {
    expect(grantsDriveAccess(undefined)).toBe(false);
    expect(grantsDriveAccess(null)).toBe(false);
    expect(grantsDriveAccess("")).toBe(false);
  });

  it("does not match a scope that merely starts with the same text", () => {
    expect(
      grantsDriveAccess("https://www.googleapis.com/auth/drive.file.extra"),
    ).toBe(false);
    expect(
      grantsDriveAccess("https://www.googleapis.com/auth/drive.readonly"),
    ).toBe(false);
  });

  it("tolerates the irregular spacing Google sometimes returns", () => {
    expect(grantsDriveAccess(`openid  ${DRIVE_FILE_SCOPE}\n`)).toBe(true);
  });
});
