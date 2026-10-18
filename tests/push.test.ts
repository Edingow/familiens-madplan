import { describe, expect, it, vi } from "vitest";

const sent: unknown[] = [];
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push([sub.endpoint, JSON.parse(payload)]);
    }),
  },
}));

describe("serverfunktion /api/push", () => {
  it("afviser forkert kode og sender til gyldige telefoner", async () => {
    process.env.PUSH_SECRET = "hemmelig"; process.env.VAPID_PUBLIC_KEY = "pub"; process.env.VAPID_PRIVATE_KEY = "priv";
    const { default: handler } = await import("../api/push");
    let status = 0, out: any;
    const res: any = { status(s: number) { status = s; return res; }, json(j: unknown) { out = j; return res; } };
    await handler({ method: "POST", headers: { "x-push-secret": "forkert" }, body: {} } as any, res);
    expect(status).toBe(401);
    await handler({ method: "POST", headers: { "x-push-secret": "hemmelig" }, body: {
      title: "Indkøbslisten", body: "Luka har tilføjet mælk", tag: "list",
      subscriptions: [{ endpoint: "https://push/jon", keys: { p256dh: "p", auth: "a" } }, { endpoint: "https://push/gone", keys: { p256dh: "p", auth: "a" } }],
    } } as any, res);
    expect(status).toBe(200);
    expect(out).toEqual({ sent: 1, gone: 1 });
    expect(sent).toEqual([["https://push/jon", { title: "Indkøbslisten", body: "Luka har tilføjet mælk", tag: "list" }]]);
  });
});
