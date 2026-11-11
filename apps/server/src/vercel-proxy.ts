import proxy from "@fastify/http-proxy";
import Fastify from "fastify";

export function studyBackendOrigin(backendOrigin: string | undefined): URL {
  const upstream = backendOrigin && URL.canParse(backendOrigin) ? new URL(backendOrigin) : null;
  if (!upstream || upstream.protocol !== "https:" || upstream.href !== upstream.origin + "/") {
    throw new Error("Set STUDY_BACKEND_ORIGIN to the HTTPS origin of the study server.");
  }

  return upstream;
}

export async function createVercelProxy(upstream: URL) {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 });
  await app.register(proxy, {
    upstream: upstream.origin,
    http2: false,
    replyOptions: {
      rewriteRequestHeaders: (_request, headers) => {
        const forwarded = { ...headers };
        delete forwarded.cookie;
        delete forwarded.authorization;
        delete forwarded["x-vercel-oidc-token"];
        return forwarded;
      },
      rewriteHeaders: (headers, request) =>
        request?.url.startsWith("/api/") ? { ...headers, "cache-control": "private, no-store" } : headers
    }
  });
  return app;
}
