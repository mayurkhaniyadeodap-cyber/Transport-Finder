import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchParams, SearchResponse } from "./services/api";

const searchTransport = vi.fn();
vi.mock("./services/api", () => ({
  searchTransport: (...args: unknown[]) => searchTransport(...args),
}));

const { searchByType, searchUnified } = await import("./searchDefaults");

const response = (n: number): SearchResponse => ({
  search: { pincode: null, city: null, state: null },
  match_level: null,
  message: null,
  results: Array.from({ length: n }, (_, i) => ({ transport_name: `T${i}` }) as SearchResponse["results"][number]),
  total: n,
});

const calledWith = (): SearchParams[] => searchTransport.mock.calls.map((c) => c[0] as SearchParams);

beforeEach(() => searchTransport.mockReset());

describe("searchByType (clicking a typed suggestion)", () => {
  it.each([
    ["pincode", "360003", { pincode: "360003", city: "", state: "", transport_name: "" }],
    ["city", "Rajkot", { pincode: "", city: "Rajkot", state: "", transport_name: "" }],
    ["state", "Gujarat", { pincode: "", city: "", state: "Gujarat", transport_name: "" }],
    ["transporter", "Pavan Parcel Service", { pincode: "", city: "", state: "", transport_name: "Pavan Parcel Service" }],
  ] as const)("searches %s directly, with only that field set -- no guessing", async (type, value, expected) => {
    searchTransport.mockResolvedValue(response(1));
    const { params } = await searchByType(type, value);
    expect(params).toEqual(expected);
    expect(searchTransport).toHaveBeenCalledTimes(1);
  });
});

describe("searchUnified (free text, no suggestion picked)", () => {
  it("a 6-digit value is searched as a pincode only", async () => {
    searchTransport.mockResolvedValue(response(1));
    await searchUnified("360003");
    expect(calledWith()).toEqual([{ pincode: "360003", city: "", state: "", transport_name: "" }]);
  });

  it("stops at City when City has results", async () => {
    searchTransport.mockResolvedValueOnce(response(3));
    const { params } = await searchUnified("Rajkot");
    expect(params.city).toBe("Rajkot");
    expect(searchTransport).toHaveBeenCalledTimes(1);
  });

  it("falls back City -> State -> Transporter Name, in that order", async () => {
    searchTransport
      .mockResolvedValueOnce(response(0)) // city
      .mockResolvedValueOnce(response(0)) // state
      .mockResolvedValueOnce(response(2)); // transporter name
    const { params } = await searchUnified("Pavan Parcel Service");
    expect(calledWith().map((p) => Object.entries(p).find(([, v]) => v)?.[0])).toEqual([
      "city", "state", "transport_name",
    ]);
    expect(params.transport_name).toBe("Pavan Parcel Service");
  });
});
