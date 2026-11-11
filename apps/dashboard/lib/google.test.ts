import { describe, expect, it, vi } from "vitest";
import {
  DRIVE_FILE_SCOPE,
  grantsDriveAccess,
  shareSpreadsheet,
} from "./google";

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

describe("private report sharing", () => {
  it("grants named editors without enabling public access", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await shareSpreadsheet("token", "sheet", ["team@example.com"], false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        role: "writer",
        type: "user",
        emailAddress: "team@example.com",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps partner handover sheets publicly readable by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await shareSpreadsheet("token", "sheet", []);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        role: "reader",
        type: "anyone",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
