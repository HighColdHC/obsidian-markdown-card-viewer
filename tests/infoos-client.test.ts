import { describe, expect, it, vi } from "vitest";
import {
  InfoOSClient,
  InfoOSRequestError,
  supportsCatalogFilter,
  type HttpRequester,
  type HttpResponse
} from "../src/infoos/client";

describe("InfoOSClient", () => {
  it("exposes capabilities and health without putting credentials in results", async () => {
    const request = vi.fn<HttpRequester>()
      .mockResolvedValueOnce(jsonResponse(200, capabilities()))
      .mockResolvedValueOnce(jsonResponse(200, {
        status: "ready",
        interface_version: "v1"
      }));
    const client = new InfoOSClient("https://infoos.example.com", "top-secret", request);

    await expect(client.testConnection()).resolves.toEqual({
      interfaceVersion: "v1",
      capabilities: capabilities().capabilities
    });
    expect(request.mock.calls[0]?.[0].headers.Authorization).toBe("Bearer top-secret");
    expect(JSON.stringify(await client.getCapabilities()
      .catch(() => null))).not.toContain("top-secret");
  });

  it("sends only filters explicitly declared by a tolerant capability name", async () => {
    const request = vi.fn<HttpRequester>().mockResolvedValue(jsonResponse(200, {
      items: [],
      next_page_token: null
    }));
    const client = new InfoOSClient("https://infoos.example.com", "token", request);

    await client.listCards({
      pageSize: 50,
      pageToken: "next",
      filters: {
        query: "needle",
        platform: "rss",
        completeness: "complete",
        mediaKind: "video"
      },
      capabilities: [
        "cards.filters.query",
        "catalog_filter_media_kind",
        "cards:read"
      ]
    });

    const url = new URL(request.mock.calls[0]![0].url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page_size: "50",
      page_token: "next",
      query: "needle",
      media_kind: "video"
    });
    expect(supportsCatalogFilter(["cards-filter-platform"], "platform")).toBe(true);
    expect(supportsCatalogFilter(["cards:read"], "query")).toBe(false);
  });

  it("walks all pages and rejects a repeated cursor", async () => {
    const request = vi.fn<HttpRequester>()
      .mockResolvedValueOnce(jsonResponse(200, {
        items: [catalogItem("card-1")],
        next_page_token: "cursor"
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        items: [catalogItem("card-2")],
        next_page_token: null
      }));
    const client = new InfoOSClient("https://infoos.example.com", "token", request);
    await expect(client.listAllCards()).resolves.toHaveLength(2);

    const repeated = vi.fn<HttpRequester>()
      .mockResolvedValueOnce(jsonResponse(200, { items: [], next_page_token: "same" }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [], next_page_token: "same" }));
    await expect(new InfoOSClient("https://infoos.example.com", "token", repeated)
      .listAllCards()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("builds token-free web deep links and validates asset routes", async () => {
    const request = vi.fn<HttpRequester>().mockResolvedValue({
      status: 200,
      headers: {},
      json: null,
      text: "",
      arrayBuffer: new ArrayBuffer(2)
    });
    const client = new InfoOSClient("https://infoos.example.com", "secret", request);

    expect(client.buildCardDeepLink("card 1"))
      .toBe("https://infoos.example.com/?menu=cards&card_id=card+1");
    expect(client.buildAssetDeepLink("card 1", "asset 1"))
      .toBe("https://infoos.example.com/?menu=cards&card_id=card+1&asset_id=asset+1");
    expect(client.buildCardDeepLink("card 1")).not.toContain("secret");
    await client.getAsset("asset-1");
    expect(request.mock.calls[0]?.[0].url)
      .toBe("https://infoos.example.com/api/plugin/v1/assets/asset-1");
    await expect(client.getAsset("https://attacker.example/steal"))
      .rejects.toMatchObject({ code: "invalid_response" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("deep-validates nested card blocks and assets", async () => {
    const valid = cardDetail("card-1");
    const malformed: unknown[] = [{
      ...valid,
      blocks: [{ ...valid.blocks[0], position: -1 }]
    }, {
      ...valid,
      blocks: [{
        block_id: "block-1",
        position: 0,
        layer: "original",
        kind: "markdown",
        original_kind: null,
        status: "ready",
        body: "body",
        source_url: null,
        provenance: null
      }]
    }, {
      ...valid,
      assets: [{ ...valid.assets[0], content_hash: "not-sha256" }]
    }, {
      ...valid,
      assets: [{ ...valid.assets[0], size_bytes: 1.5 }]
    }, {
      ...valid,
      assets: [{ ...valid.assets[0], width: -1 }]
    }, {
      ...valid,
      assets: [{ ...valid.assets[0], duration_seconds: "12" }]
    }];

    for (const response of malformed) {
      const request = vi.fn<HttpRequester>().mockResolvedValue(jsonResponse(200, response));
      await expect(new InfoOSClient("https://infoos.example.com", "token", request)
        .getCard("card-1")).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("rejects a detail response for a different requested card", async () => {
    const request = vi.fn<HttpRequester>()
      .mockResolvedValue(jsonResponse(200, cardDetail("different-card")));
    await expect(new InfoOSClient("https://infoos.example.com", "token", request)
      .getCard("card-1")).rejects.toMatchObject({ code: "conflict" });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [416, "range_not_satisfiable"],
    [429, "rate_limited"],
    [503, "server_error"]
  ])("maps HTTP %i distinctly", async (status, code) => {
    const request = vi.fn<HttpRequester>().mockResolvedValue(jsonResponse(status, {
      code: "server-code",
      request_id: "request-1"
    }));
    const client = new InfoOSClient("https://infoos.example.com", "secret", request);
    const error = await client.getCard("card-1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InfoOSRequestError);
    expect(error).toMatchObject({ code, status, requestId: "request-1" });
    expect(String(error)).not.toContain("secret");
  });

  it("maps transport failures and checks cancellation before and after transport", async () => {
    const network = vi.fn<HttpRequester>().mockRejectedValue(new Error("secret URL"));
    await expect(new InfoOSClient("https://infoos.example.com", "token", network)
      .listCards()).rejects.toMatchObject({ code: "network_error" });

    const controller = new AbortController();
    controller.abort();
    const request = vi.fn<HttpRequester>();
    await expect(new InfoOSClient("https://infoos.example.com", "token", request)
      .listCards({}, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(request).not.toHaveBeenCalled();

    const afterController = new AbortController();
    const delayed = vi.fn<HttpRequester>().mockImplementation(async () => {
      afterController.abort();
      return jsonResponse(200, { items: [], next_page_token: null });
    });
    await expect(new InfoOSClient("https://infoos.example.com", "token", delayed)
      .listCards({}, afterController.signal)).rejects.toMatchObject({ code: "cancelled" });
  });
});

function jsonResponse(status: number, json: unknown): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    json,
    text: JSON.stringify(json),
    arrayBuffer: new ArrayBuffer(0)
  };
}

function capabilities() {
  return {
    interface_version: "v1",
    card_schema: "infoos.information-card.v1",
    capabilities: ["cards:read", "assets:read"],
    default_page_size: 100,
    max_page_size: 200,
    source_schema: "infoos.source-catalog.v1",
    catalog_filters: ["query", "platform", "completeness", "media_kind", "source_id"],
    web_deep_links: false
  };
}

function catalogItem(cardId: string): Record<string, unknown> {
  return {
    card_id: cardId,
    card_type: "information",
    version: 1,
    content_hash: `hash-${cardId}`,
    title: cardId,
    source_platform: "rss",
    source_url: "https://example.com/post?private=removed",
    published_at: null,
    updated_at: "2026-07-30T00:00:00Z",
    status: "active",
    completeness_status: "complete",
    excerpt: "摘要",
    source_id: "source-rss",
    asset_summary: {
      image_count: 1,
      video_count: 0,
      audio_count: 0,
      other_count: 0,
      poster_asset_id: "asset-poster"
    }
  };
}

function cardDetail(cardId: string) {
  return {
    schema: "infoos.information-card.v1",
    card: {
      ...catalogItem(cardId),
      source_type: "rss",
      source_author: null,
      captured_at: "2026-07-30T00:00:00Z",
      missing_reasons: [],
      processor_version: "v1",
      raw_connector_id: null,
      raw_item_id: null,
      source_run_id: null
    },
    blocks: [{
      block_id: "block-1",
      position: 0,
      layer: "original",
      kind: "markdown",
      original_kind: null,
      status: "ready",
      body: "body",
      segments: [],
      source_url: null,
      provenance: null
    }],
    assets: [{
      asset_id: "asset-1",
      kind: "image",
      mime_type: "image/png",
      size_bytes: 5,
      content_hash: "sha256:6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d",
      status: "ready",
      url: "/api/plugin/v1/assets/asset-1",
      title: "image",
      source_url: null,
      duration_seconds: null,
      width: 10,
      height: 10
    }]
  };
}
