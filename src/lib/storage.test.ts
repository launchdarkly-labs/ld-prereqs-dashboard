import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../test/web-storage";
import type { OAuthCredential } from "./credential";

const local = new MemoryStorage();
const session = new MemoryStorage();
let storage: typeof import("./storage");

beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  storage = await import("./storage"); // isBrowser is evaluated at import time
});

beforeEach(() => {
  local.clear();
  session.clear();
});

const oauth: OAuthCredential = {
  kind: "oauth",
  instance: "eu",
  clientId: "c",
  accessToken: "a",
  refreshToken: "r",
};

describe("credential storage", () => {
  it("still reads a token saved by the pre-OAuth version (raw string key)", () => {
    local.setItem("ld-dash.token", "api-legacy");
    expect(storage.loadCredential()).toEqual({
      credential: { kind: "token", token: "api-legacy" },
      remembered: true,
    });
  });

  it("keeps the API token's on-disk format unchanged", () => {
    storage.saveCredential({ kind: "token", token: "api-1" }, false);
    expect(session.getItem("ld-dash.token")).toBe("api-1");
    expect(local.length).toBe(0);
  });

  it("round-trips an OAuth credential, remembered in localStorage", () => {
    storage.saveCredential(oauth, true);
    expect(storage.loadCredential()).toEqual({ credential: oauth, remembered: true });
    expect(session.length).toBe(0);
  });

  it("replaces one credential kind with the other", () => {
    storage.saveCredential({ kind: "token", token: "api-1" }, false);
    storage.saveCredential(oauth, false);
    expect(session.getItem("ld-dash.token")).toBeNull();
    expect(storage.loadCredential()?.credential).toEqual(oauth);
  });

  it("clears both kinds from both stores", () => {
    local.setItem("ld-dash.token", "api-1");
    session.setItem("ld-dash.oauth", JSON.stringify(oauth));
    storage.clearCredential();
    expect(storage.loadCredential()).toBeNull();
  });
});
