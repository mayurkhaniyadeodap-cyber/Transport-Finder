import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSession } from "../session";
import {
  addTransporter, deleteTransporter, listManagedTransporters, listOverrides, removeTransporterPhoto, restoreTransporter,
  updateTransporter, uploadTransporterPhoto,
} from "./overridesApi";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [], total: 0, deleted: [] }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => sessionStorage.clear());

const authOf = (i: number) => (fetchMock.mock.calls[i][1]?.headers as Record<string, string>)?.Authorization;

describe("Manage Transporters requests carry the signed-in session", () => {
  it("every call sends the session token (the server checks it's the Admin)", async () => {
    saveSession({ role: "admin", token: "tok-admin" });
    await listManagedTransporters();
    await addTransporter({ transport_name: "Om Logistics", service_cities: [], pincodes: ["395007"], status: "Active" });
    await updateTransporter("Om Logistics", { shipment_charge: "75.50" });
    await deleteTransporter("Om Logistics");
    await restoreTransporter("Om Logistics");
    await removeTransporterPhoto("Om Logistics");
    await listOverrides();
    await uploadTransporterPhoto("Om Logistics", new File([new Uint8Array([0x89, 0x50])], "a.png", { type: "image/png" }));
    expect(fetchMock).toHaveBeenCalledTimes(8);
    fetchMock.mock.calls.forEach((_, i) => expect(authOf(i)).toBe("Bearer tok-admin"));
    expect((fetchMock.mock.calls[7][1]?.headers as Record<string, string>)["Content-Type"]).toBe("image/png"); // upload keeps its type
  });

  it("without a session no token is sent (so the server answers 401)", async () => {
    await listManagedTransporters();
    expect(authOf(0)).toBeUndefined();
  });

  it("shows the server's message when the request is refused", async () => {
    saveSession({ role: "user", token: "tok-user" });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ detail: "Only the Admin can do this." }) });
    await expect(updateTransporter("Om Logistics", { mobile: "1" })).rejects.toThrow("Only the Admin can do this.");
  });
});
