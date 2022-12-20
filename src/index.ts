import {
  DecisionMode,
  Flagship,
  HitType,
  IVisitorCacheImplementation,
  LogLevel,
  VisitorCacheDTO,
} from "@flagship.io/js-sdk/dist/index.lite";

import {
  getAssetFromKV,
  mapRequestToAsset,
} from "@cloudflare/kv-asset-handler";

import cookie from "cookie";

import bucketingData from "./bucketing.json";

export interface Env {
  VISITOR_CACHE_KV: KVNamespace;
  API_KEY: string;
  ENV_ID: string;
  __STATIC_CONTENT: KVNamespace;
}

const html = (
  flagValue: unknown,
  visitorId: string,
  region?: string
) => `<!DOCTYPE html>
<body>
  <h1>Hello World from ${region}</h1>
  <p>This is my Cloudflare Edge Worker using Flagship for the visitorID : <span style="color: red;">${visitorId}</span> <br/>  the flag <span style="color: red;">${flagValue}</span>.</p>
</body>`;

const FS_VISITOR_ID_COOKIE_NAME = "fs_visitor_id";
const DEBUG = false;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const visitorCacheImplementation: IVisitorCacheImplementation = {
      cacheVisitor: async (
        visitorId: string,
        data: VisitorCacheDTO
      ): Promise<void> => {
        await env.VISITOR_CACHE_KV.put(visitorId, JSON.stringify(data));
      },
      lookupVisitor: async (visitorId: string): Promise<VisitorCacheDTO> => {
        const caches = await env.VISITOR_CACHE_KV.get(visitorId);
        return caches ? JSON.parse(caches) : caches;
      },
      flushVisitor: async (visitorId: string): Promise<void> => {
        await env.VISITOR_CACHE_KV.delete(visitorId);
      },
    };
    // Start the SDK
    Flagship.start(env.ENV_ID, env.API_KEY, {
      decisionMode: DecisionMode.EDGE,
      logLevel: LogLevel.NONE,
      visitorCacheImplementation,
      initialBucketing: bucketingData, // Set bucketing data fetched from flagship CDN
    });

    console.log("env", env);

    const cookies = cookie.parse(request.headers.get("Cookie") || "");

    //Get visitor Id from cookies
    const visitorId = cookies[FS_VISITOR_ID_COOKIE_NAME];

    const visitor = Flagship.newVisitor({
      visitorId, // if no visitor id exists from the cookie, the SDK will generate one
    });

    await visitor.fetchFlags();

    const flag = visitor.getFlag("my_flag_key", "default-value");

    const flagValue = flag.getValue();

    await visitor.sendHit({
      type: HitType.PAGE,
      documentLocation: "page",
    });

    // close the SDK to batch and send all hits

    let options: Record<string, any> = {};
    let response: Response = new Response();
    try {
      const page = await getAssetFromKV(
        {
          request,
          waitUntil(promise) {
            return ctx.waitUntil(promise);
          },
        },
        { ASSET_NAMESPACE: env.VISITOR_CACHE_KV }
      );
      // allow headers to be altered
      response = new Response(page.body, page);
      response.headers.set("content-type", "text/html;charset=UTF-8");
      response.headers.set(
        "Set-Cookie",
        cookie.serialize(FS_VISITOR_ID_COOKIE_NAME, visitor.visitorId)
      );
    } catch (e: any) {
      if (!DEBUG) {
        try {
          let notFoundResponse = await getAssetFromKV(
            {
              request,
              waitUntil(promise) {
                return ctx.waitUntil(promise);
              },
            },
            {
              ASSET_NAMESPACE: env.__STATIC_CONTENT,
              mapRequestToAsset: (req) =>
                new Request(`${new URL(req.url).origin}/404.html`, req),
            }
          );

          return new Response(notFoundResponse.body, {
            ...notFoundResponse,
            status: 404,
          });
        } catch (e) {
          console.log("e", e);
        }
      }
      return new Response(e.message || e.toString(), { status: 500 });
    }

    ctx.waitUntil(Flagship.close());
    return response;
  },
};
