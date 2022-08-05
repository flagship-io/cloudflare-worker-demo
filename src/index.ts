/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import {
  Flagship,
  HitType,
  IVisitorCacheImplementation,
  VisitorCacheDTO,
} from "./flagship.bundle";

import bucketingFile from "./bucketing.json";

export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  VISITOR_CACHE_KV: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;
  API_KEY: string;
  ENV_ID: string;
}

const html = (flagValue: unknown, visitorId: string) => `<!DOCTYPE html>
<body>
  <h1>Hello World</h1>
  <p>This is my Cloudflare Worker using for the visitorID : <span style="color: red;">${visitorId}</span> the flag <span style="color: red;">${flagValue}</span>.</p>
</body>`;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const visitorCacheImplementation: IVisitorCacheImplementation = {
      cacheVisitor: async (
        visitorId: string,
        Data: VisitorCacheDTO
      ): Promise<void> => {
        await env.VISITOR_CACHE_KV.put(visitorId, JSON.stringify(Data));
      },
      lookupVisitor: async (visitorId: string): Promise<VisitorCacheDTO> => {
        const caches = await env.VISITOR_CACHE_KV.get(visitorId);
        return caches ? JSON.parse(caches) : caches;
      },
      flushVisitor: async (visitorId: string): Promise<void> => {
        await env.VISITOR_CACHE_KV.delete(visitorId);
      },
    };

    Flagship.start(env.ENV_ID, env.API_KEY, {
      visitorCacheImplementation,
      isCloudFlareClient: true,
      initialBucketing: bucketingFile,
    });
    const { searchParams } = new URL(request.url);

    const context = JSON.parse(searchParams.get("context") || "{}");

    const visitor = Flagship.newVisitor({
      visitorId: searchParams.get("visitorId"),
      context,
    });
    await visitor?.fetchFlags();

    const flag = visitor?.getFlag("js", "default-value");

    const flagValue = flag?.getValue();

    await visitor.sendHit({
      type: HitType.PAGE,
      documentLocation: "page",
    });

    // await flag.userExposed();

    return new Response(html(flagValue, visitor.visitorId), {
      headers: {
        "content-type": "text/html;charset=UTF-8",
      },
    });
  },
};
