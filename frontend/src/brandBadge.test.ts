import { describe, expect, it } from "vitest";
import { initials } from "./brandBadge";

describe("initials (short name shown when a transporter has no image)", () => {
  it.each([
    ["Baradi Roadways", "BR"],
    ["Gujarat Transport Service", "GTS"],
    ["TCI Express", "TE"],
    ["VRL Logistics", "VL"],
  ])("%s -> %s", (name, short) => {
    expect(initials(name)).toBe(short);
  });

  it("ignores company-form words, bracketed abbreviations and punctuation", () => {
    expect(initials("Jaipur Golden Transport Co. Pvt. Ltd")).toBe("JGT");
    expect(initials("Sugam Parivahan Pvt.Ltd")).toBe("SP");
    expect(initials("Associated Road Carriers Limited (Arc)")).toBe("ARC");
    expect(initials("(Mitco) Mehta Transport")).toBe("MT");
    expect(initials("Babubhai And Co. Transport")).toBe("BT");
  });

  it("uses at most three letters, two for a single word", () => {
    expect(initials("Necc North Eastern Carrying Corporation Ltd")).toBe("NNE");
    expect(initials("Vtrans")).toBe("VT");
    expect(initials("  kishan   travels ")).toBe("KT");
  });

  it("never returns an empty tile", () => {
    expect(initials("Pvt Ltd")).toBe("PL");
    expect(initials("(Arc)")).toBe("AR");
    expect(initials("--")).toBe("?");
  });
});
