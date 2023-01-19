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
  serveSinglePageApp,
} from "@cloudflare/kv-asset-handler";

import cookie from "cookie";

import bucketingData from "./bucketing.json";

import stringTemplate from "string-template";

const FS_VISITOR_ID_COOKIE_NAME = "fs_visitor_id";
const DEBUG = false;

addEventListener("fetch", (event) => {
  event.respondWith(handleEvent(event));
});

async function UseFlagship(event: FetchEvent) {
  const { request } = event;
  const visitorCacheImplementation: IVisitorCacheImplementation = {
    cacheVisitor: async (
      visitorId: string,
      data: VisitorCacheDTO
    ): Promise<void> => {
      await VISITOR_CACHE_KV.put(visitorId, JSON.stringify(data));
    },
    lookupVisitor: async (visitorId: string): Promise<VisitorCacheDTO> => {
      const caches = await VISITOR_CACHE_KV.get(visitorId);
      return caches ? JSON.parse(caches) : caches;
    },
    flushVisitor: async (visitorId: string): Promise<void> => {
      await VISITOR_CACHE_KV.delete(visitorId);
    },
  };

  let logs = "";

  function onLog(level: number, tag: any, message: any) {
    const now = new Date(Date.now());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getTwoDigit = (value: any) => {
      return value.toString().length === 1 ? `0${value}` : value;
    };

    logs += `[${getTwoDigit(now.getFullYear())}-${getTwoDigit(
      now.getMonth()
    )}-${getTwoDigit(now.getDay())} ${getTwoDigit(
      now.getHours()
    )}:${getTwoDigit(now.getMinutes())}:${getTwoDigit(
      now.getSeconds()
    )}.${getTwoDigit(now.getMilliseconds())}] [${"Flagship SDK"}] [${
      LogLevel[level]
    }] [${tag}] : ${message} <br/>`;
  }

  // Start the SDK
  Flagship.start(ENV_ID, API_KEY, {
    decisionMode: DecisionMode.EDGE,
    logLevel: LogLevel.ALL,
    visitorCacheImplementation,
    initialBucketing: bucketingData,
    onLog,
  });

  const cookies = cookie.parse(request.headers.get("Cookie") || "");

  //Get visitor Id from cookies
  const visitorId = cookies[FS_VISITOR_ID_COOKIE_NAME];

  const visitor = Flagship.newVisitor({
    visitorId, // if no visitor id exists from the cookie, the SDK will generate one
  });

  await visitor.fetchFlags();

  const shopBtnVariantOriginal = "primary";

  const shopBtnVariant = visitor.getFlag(
    "shopBtnVariant",
    shopBtnVariantOriginal
  );

  const showPromotionOriginal = "hide";
  const showPromotion = visitor.getFlag("showPromotion", showPromotionOriginal);

  await visitor.sendHit({
    type: HitType.PAGE,
    documentLocation: request.url,
  });

  return {
    shopBtnVariantOriginal,
    showPromotionOriginal,
    shopBtnVariant: shopBtnVariant.getValue(),
    showPromotion: showPromotion.getValue(),
    visitorId: visitor.visitorId,
    logs,
  };
}

async function handleEvent(event: FetchEvent) {
  const now = Date.now();
  const { request } = event;

  if (!request.headers.get("accept")?.includes("text/html")) {
    try {
      return await getAssetFromKV(event);
    } catch (e) {
      let pathname = new URL(event.request.url).pathname;
      return new Response(`"${pathname}" not found`, {
        status: 404,
        statusText: "not found",
      });
    }
  }

  try {
    const {
      shopBtnVariant,
      showPromotion,
      visitorId,
      logs,
      shopBtnVariantOriginal,
      showPromotionOriginal,
    } = await UseFlagship(event);
    // Add logic to decide whether to serve an asset or run your original Worker code
    const response = await getAssetFromKV(event);

    const htmlContent = await response.text();

    const cf = request.cf;
    const htmlContentFormatted = stringTemplate(htmlContent, {
      shopBtnVariant,
      showPromotion,
      colo: cf?.colo,
      country: cf?.country,
      city: cf?.city,
      continent: cf?.continent,
      logs,
      shopBtnVariantOriginal,
      showPromotionOriginal,
      runDuration: Date.now() - now,
    });

    const formattedResponse = new Response(htmlContentFormatted, response);
    formattedResponse.headers.set(
      "Set-Cookie",
      cookie.serialize(FS_VISITOR_ID_COOKIE_NAME, visitorId)
    );
    event.waitUntil(Flagship.close());
    return formattedResponse;
  } catch (e) {
    let pathname = new URL(event.request.url).pathname;
    event.waitUntil(Flagship.close());
    return new Response(`"${pathname}" not found`, {
      status: 404,
      statusText: "not found",
    });
  }
}
