import { describe, expect, it } from "vitest";
import {
  colorToHex,
  parseVerificationCodeInput,
  parseVerificationSettingsPatch,
} from "./verification";

describe("verification dashboard validation", () => {
  it("normalizes a complete settings request and control actions", () => {
    const result = parseVerificationSettingsPatch({
      verificationChannelId: "123456789012345678",
      allowedChannelIds: ["123456789012345679"],
      defaultRoleIds: ["123456789012345680"],
      welcomeTitle: "  Welcome to KOS  ",
      welcomeColor: "#C0C0C0",
      requireCode: true,
      requireRulesAcceptance: false,
      preventCodeReuse: true,
      desiredEnabled: true,
      syncAccess: true,
      publishPanel: true,
    });

    expect(result).toEqual({
      value: expect.objectContaining({
        settings: expect.objectContaining({
          welcomeTitle: "Welcome to KOS",
          welcomeColor: 12632256,
        }),
        control: {
          desiredEnabled: true,
          syncAccess: true,
          publishPanel: true,
        },
      }),
    });
    expect(colorToHex(12632256)).toBe("#c0c0c0");
  });

  it("rejects invalid Discord ids and oversized role grants", () => {
    expect(
      parseVerificationSettingsPatch({
        verificationChannelId: "not-discord",
      }),
    ).toEqual({
      error: "Verification channel must be a valid Discord selection.",
    });
    expect(
      parseVerificationCodeInput({
        code: "ALPHA",
        roleIds: Array.from(
          { length: 11 },
          (_, index) => `12345678901234567${index}`,
        ),
        active: true,
        oneTimePerMember: true,
      }),
    ).toEqual({
      error: "Role grants must contain no more than 10 valid Discord roles.",
    });
  });

  it("normalizes codes and supports unlimited use with no expiration", () => {
    const result = parseVerificationCodeInput({
      code: " alpha-1 ",
      description: " Alpha group ",
      roleIds: ["123456789012345678"],
      maxUses: "",
      expiresAt: "",
      active: true,
      oneTimePerMember: false,
    });
    expect(result).toEqual({
      value: {
        code: "ALPHA-1",
        description: "Alpha group",
        roleIds: ["123456789012345678"],
        maxUses: null,
        expiresAt: null,
        active: true,
        oneTimePerMember: false,
      },
    });
  });
});
