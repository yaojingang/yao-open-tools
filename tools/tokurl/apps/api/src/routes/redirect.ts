import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { enqueueClick } from "../services/analytics.js";
import { getRedirectLink } from "../services/links.js";
import { getSiteSettings, siteSettingsCacheKeys } from "../services/settings.js";
import { isValidCustomSlug } from "../utils/slug.js";

interface RouteContext {
  config: AppConfig;
  db: DbClient;
  redis: Redis;
}

const redirectAnalyticsCacheTtlSeconds = 60;
const redirectTrackingDelayMs = 1_150;
const redirectTrackingFallbackMs = 2_100;
const redirectTrackingCsp = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' https: 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' https: 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "connect-src 'self' https:",
  "frame-src https:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests"
].join("; ");

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function toSafeJson(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function toSafeJsonLiteral(value: string): string {
  return toSafeJson(value);
}

async function getRedirectAnalyticsCode(context: RouteContext): Promise<string> {
  const cached = await context.redis.get(siteSettingsCacheKeys.redirectAnalyticsCode).catch(() => null);
  if (cached !== null) {
    return cached;
  }

  const settings = await getSiteSettings({ db: context.db });
  const code = settings.redirectAnalyticsEnabled ? settings.analyticsCode.trim() : "";
  await context.redis.set(siteSettingsCacheKeys.redirectAnalyticsCode, code, "EX", redirectAnalyticsCacheTtlSeconds).catch(() => null);
  return code;
}

function sendDirectRedirect(reply: FastifyReply, context: RouteContext, targetUrl: string) {
  return reply.status(context.config.redirectStatus).header("Location", targetUrl).header("Cache-Control", "no-store").send();
}

export function renderTrackedRedirectPage(input: { targetUrl: string; slug: string; analyticsCode: string }): string {
  const targetUrl = toSafeJsonLiteral(input.targetUrl);
  const slug = toSafeJsonLiteral(input.slug);
  const carouselLines = toSafeJson([
    "把漫长的网址，折成一枚轻舟",
    "让路径变短，让抵达更近",
    "光标轻落，下一页已在路上",
    "风从短链经过，页面即将打开"
  ]);
  const escapedTargetUrl = escapeHtml(input.targetUrl);
  const escapedSlug = escapeHtml(input.slug);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <meta http-equiv="refresh" content="3;url=${escapedTargetUrl}" />
    <title>即将抵达 - ${escapedSlug}</title>
    ${input.analyticsCode}
    <script>
      (() => {
        document.documentElement.classList.add("has-js");
        const targetUrl = ${targetUrl};
        const slug = ${slug};
        const carouselLines = ${carouselLines};
        let redirected = false;
        const redirect = () => {
          if (redirected) return;
          redirected = true;
          window.location.replace(targetUrl);
        };
        const rotateCopy = () => {
          const messageNode = document.querySelector("[data-redirect-line]");
          const dots = Array.from(document.querySelectorAll("[data-redirect-dot]"));
          if (!messageNode || carouselLines.length < 2) return;

          let index = 0;
          const render = () => {
            messageNode.classList.add("is-changing");
            window.setTimeout(() => {
              messageNode.textContent = carouselLines[index];
              dots.forEach((dot, dotIndex) => {
                dot.classList.toggle("is-active", dotIndex === index);
              });
              messageNode.classList.remove("is-changing");
            }, 120);
          };

          window.setInterval(() => {
            index = (index + 1) % carouselLines.length;
            render();
          }, 560);
        };
        const trackRedirect = () => {
          try {
            const pagePath = window.location.pathname + window.location.search + window.location.hash;
            if (typeof window.gtag === "function") {
              window.gtag("event", "tokurl_redirect", {
                event_category: "TokURL",
                event_label: slug,
                page_location: window.location.href,
                page_path: pagePath,
                transport_type: "beacon"
              });
            }
            if (Array.isArray(window._hmt)) {
              window._hmt.push(["_trackEvent", "TokURL", "redirect", slug]);
              window._hmt.push(["_trackPageview", pagePath]);
            }
            if (typeof window.plausible === "function") {
              window.plausible("tokurl_redirect", { props: { slug } });
            }
          } catch {
            // Redirect must never depend on third-party analytics code.
          }
        };
        window.addEventListener("load", () => {
          rotateCopy();
          trackRedirect();
          window.setTimeout(() => {
            document.querySelector("[data-manual-link]")?.classList.add("is-visible");
          }, 1800);
          window.setTimeout(redirect, ${redirectTrackingDelayMs});
        });
        window.setTimeout(redirect, ${redirectTrackingFallbackMs});
      })();
    </script>
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        min-height: 100dvh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at 50% 8%, rgba(22, 119, 255, 0.10), transparent 34%),
          linear-gradient(180deg, #f8fbff 0%, #f3f6fb 100%);
        color: #151922;
      }

      main {
        width: calc(100vw - 48px);
        max-width: 500px;
        padding: 34px;
        border: 1px solid #e2e8f0;
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
      }

      .kicker {
        margin: 0 0 12px;
        color: #1677ff;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0;
      }

      h1 {
        margin: 0;
        font-size: clamp(30px, 6vw, 42px);
        line-height: 1.12;
        letter-spacing: 0;
      }

      .redirect-line {
        min-height: 66px;
        margin: 22px 0 20px;
        color: #4b5563;
        font-size: 20px;
        font-weight: 650;
        line-height: 1.65;
        transition: opacity 160ms ease, transform 160ms ease;
      }

      .redirect-line.is-changing {
        opacity: 0.82;
        transform: translateY(4px);
      }

      .progress {
        width: 100%;
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: #eaf1ff;
      }

      .progress span {
        display: block;
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #1677ff, #5da8ff);
        animation: progress 1.25s ease-in-out infinite;
      }

      .dots {
        display: flex;
        gap: 7px;
        align-items: center;
        margin: 18px 0 0;
      }

      .dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #cbd5e1;
        transition: width 180ms ease, background 180ms ease;
      }

      .dot.is-active {
        width: 22px;
        background: #1677ff;
      }

      .manual-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        margin-top: 22px;
        padding: 0 16px;
        border: 1px solid #dbeafe;
        border-radius: 12px;
        color: #1677ff;
        background: #f8fbff;
        font-weight: 800;
        text-decoration: none;
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
        transition: opacity 180ms ease, transform 180ms ease, border-color 180ms ease;
      }

      .has-js .manual-link {
        opacity: 0;
        pointer-events: none;
        transform: translateY(4px);
      }

      .has-js .manual-link.is-visible,
      .manual-link:focus-visible,
      .manual-link:hover {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }

      .manual-link:hover {
        border-color: #1677ff;
      }

      @keyframes progress {
        0% { transform: translateX(-105%); }
        100% { transform: translateX(245%); }
      }

      @media (max-width: 480px) {
        body {
          padding: 18px;
        }

        main {
          width: calc(100vw - 36px);
          padding: 26px 22px;
          border-radius: 18px;
        }

        .redirect-line {
          min-height: 72px;
          font-size: 18px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .progress span,
        .redirect-line,
        .dot,
        .manual-link {
          animation: none;
          transition: none;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="kicker">TokURL</p>
      <h1>即将抵达</h1>
      <p class="redirect-line" data-redirect-line aria-live="polite">把漫长的网址，折成一枚轻舟</p>
      <div class="progress" aria-hidden="true"><span></span></div>
      <div class="dots" aria-label="抵达进度">
        <span class="dot is-active" data-redirect-dot></span>
        <span class="dot" data-redirect-dot></span>
        <span class="dot" data-redirect-dot></span>
        <span class="dot" data-redirect-dot></span>
      </div>
      <a class="manual-link" data-manual-link href="${escapedTargetUrl}" rel="nofollow noreferrer">继续前往</a>
    </main>
  </body>
</html>`;
}

export async function registerRedirectRoute(app: FastifyInstance, context: RouteContext) {
  async function redirectHandler(request: FastifyRequest, reply: FastifyReply) {
    const { slug } = request.params as { slug: string };

    if (!isValidCustomSlug(slug)) {
      return reply.status(404).send({
        error: "not_found",
        message: "Short link was not found."
      });
    }

    const link = await getRedirectLink(context, slug);

    if (!link) {
      return reply.status(404).send({
        error: "not_found",
        message: "Short link was not found."
      });
    }

    if (context.config.analyticsEnabled) {
      void enqueueClick(context.redis, {
        linkId: link.id,
        slug: link.slug,
        referrer: request.headers.referer ?? null,
        userAgent: request.headers["user-agent"] ?? null,
        ip: request.ip,
        hashSalt: context.config.hashSalt
      }).catch((error) => request.log.warn({ error, slug }, "Failed to enqueue click analytics"));
    }

    if (request.method === "HEAD") {
      return sendDirectRedirect(reply, context, link.targetUrl);
    }

    const analyticsCode = await getRedirectAnalyticsCode(context).catch((error) => {
      request.log.warn({ error, slug }, "Failed to load redirect analytics code");
      return "";
    });

    if (!analyticsCode) {
      return sendDirectRedirect(reply, context, link.targetUrl);
    }

    return reply
      .status(200)
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("Content-Security-Policy", redirectTrackingCsp)
      .send(renderTrackedRedirectPage({ targetUrl: link.targetUrl, slug: link.slug, analyticsCode }));
  }

  app.route({
    method: ["GET", "HEAD"],
    url: "/:slug",
    handler: redirectHandler
  });
}
