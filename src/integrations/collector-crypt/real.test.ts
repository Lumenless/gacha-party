import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectorCryptOpeningPendingError, RealCollectorCryptAdapter } from "./real";

afterEach(() => vi.unstubAllGlobals());

describe("RealCollectorCryptAdapter", () => {
  it("lists devnet machines without requiring an attribution key", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/api/status")
        ? { machineStatus: "running", gachas: [{ code: "pokemon_50", status: "open", isOpen: true }] }
        : {
            machines: [{
              code: "pokemon_50",
              name: "Elite Pokémon Gacha Pack",
              shortName: "PKMN 50",
              image: "",
              thumbnailUrl: "/pokemon_50.png",
              price: 50,
              instantBuyback: 85,
              public: true,
              stock: { common: 1, uncommon: 0, rare: 0, epic: 0 },
            }],
          },
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [pack] = await new RealCollectorCryptAdapter().listPacks();
    expect(pack.priceBaseUnits).toBe(50_000_000n);
    expect(pack.imageUrl).toBe("https://dev-gacha.collectorcrypt.com/pokemon_50.png");
    expect(pack.isOpen).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.has("x-api-key")).toBe(false);
  });

  it("prepares non-turbo custodial purchases", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ memo: "memo-1", transaction: "dHg=" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new RealCollectorCryptAdapter({ apiKey: "attribution" }).preparePurchase({
      playerAddress: "operator",
      cardRecipient: "custody",
      packCode: "pokemon_50",
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      playerAddress: "operator",
      packType: "pokemon_50",
      turbo: false,
      altPlayerAddress: "custody",
    });
    expect(new Headers(init.headers).get("x-api-key")).toBe("attribution");
  });

  it("treats webhook confirmation as a retryable opening state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      code: "WAITING_FOR_WEBHOOK",
      memo: "memo-1",
    }), { status: 200 })));
    await expect(new RealCollectorCryptAdapter().openPack("memo-1")).rejects.toBeInstanceOf(CollectorCryptOpeningPendingError);
  });
});
