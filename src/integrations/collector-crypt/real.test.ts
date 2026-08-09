import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CollectorCryptMachineUnavailableError,
  CollectorCryptOpeningPendingError,
  RealCollectorCryptAdapter,
} from "./real";

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
              lowThreshold: 20,
              stock: { common: 21, uncommon: 21, rare: 21, epic: 21 },
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

  it("translates an empty machine into a safe retryable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Internal server error",
      details: "Machine is empty",
    }), { status: 500 })));

    await expect(new RealCollectorCryptAdapter().preparePurchase({
      playerAddress: "operator",
      packCode: "pokemon_25",
    })).rejects.toBeInstanceOf(CollectorCryptMachineUnavailableError);
  });

  it("does not advertise a machine with an empty prize tier", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/api/status")
        ? { machineStatus: "running", gachas: [{ code: "pokemon_25", status: "open", isOpen: true }] }
        : {
            machines: [{
              code: "pokemon_25",
              name: "Starter Pokémon Gacha Pack",
              shortName: "Starter",
              price: 25,
              instantBuyback: 85,
              public: true,
              lowThreshold: 0,
              stock: { common: 10, uncommon: 0, rare: 3, epic: 1 },
            }],
          },
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [pack] = await new RealCollectorCryptAdapter().listPacks();
    expect(pack.isOpen).toBe(false);
  });

  it("does not advertise a machine at or below its low-stock threshold", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/api/status")
        ? { machineStatus: "running", gachas: [{ code: "pokemon_25", status: "open", isOpen: true }] }
        : {
            machines: [{
              code: "pokemon_25",
              name: "Starter Pokémon Gacha Pack",
              shortName: "PKMN 25",
              price: 25,
              instantBuyback: 85,
              public: true,
              lowThreshold: 20,
              stock: { common: 19, uncommon: 735, rare: 2096, epic: 89 },
            }],
          },
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [pack] = await new RealCollectorCryptAdapter().listPacks();
    expect(pack.isOpen).toBe(false);
  });

  it("fails closed when machine inventory safety metadata is missing", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/api/status")
        ? { machineStatus: "running", gachas: [{ code: "pokemon_50", status: "open", isOpen: true }] }
        : {
            machines: [{
              code: "pokemon_50",
              name: "Elite Pokémon Gacha Pack",
              shortName: "PKMN 50",
              price: 50,
              instantBuyback: 85,
              public: true,
            }],
          },
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [pack] = await new RealCollectorCryptAdapter().listPacks();
    expect(pack.isOpen).toBe(false);
  });
});
