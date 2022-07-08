/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Flagship, HitType } from "./flagship.bundle.js";

import bucketingFile from "./bucketing.json";

export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  // MY_KV_NAMESPACE: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;
  API_KEY: string;
  ENV_ID: string;
}

const html = (flagValue: unknown) => `<!DOCTYPE html>
<body>
  <h1>Hello World</h1>
  <p>This is my Cloudflare Worker using the flag <span style="color: red;">${flagValue}<span>.</p>
</body>`;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    Flagship.start(env.ENV_ID, env.API_KEY, {
      isCloudFlareClient: true,
      initialBucketing: bucketingFile,
    });
    const visitor = Flagship.newVisitor();
    await visitor?.fetchFlags();

    const flag = visitor?.getFlag("js", "default-value");

    const flagValue = flag?.getValue();

    await visitor.sendHit({
      type: HitType.PAGE,
      documentLocation: "page",
    });

    // await flag.userExposed();

    return new Response(html(flagValue), {
      headers: {
        "content-type": "text/html;charset=UTF-8",
      },
    });
  },
};
