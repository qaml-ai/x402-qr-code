import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { stripeApiKeyMiddleware } from "x402-stripe";
import { openapiFromMiddleware } from "x402-openapi";
import qrcode from "qrcode-generator";

const app = new Hono<{ Bindings: Env }>();

const ROUTES = {
  "POST /": {
    accepts: [
      { scheme: "exact", price: "$0.001", network: "eip155:8453", payTo: "0x0" as `0x${string}` },
      { scheme: "exact", price: "$0.001", network: "eip155:137", payTo: "0x0" as `0x${string}` },
      { scheme: "exact", price: "$0.001", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", payTo: "CvraJ4avKPpJNLvMhMH5ip2ihdt85PXvDwfzXdziUxRq" },
    ],
    description: "Generate a QR code from text or URL. Send {\"text\": \"https://example.com\"}",
    mimeType: "image/svg+xml",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: {
              text: { type: "string", description: "The text or URL to encode as a QR code", required: true },
              size: { type: "number", description: "Size in pixels (32-1024, default 256)", required: false },
            },
          },
          output: { type: "raw" },
        },
        schema: {
          properties: {
            input: {
              properties: { method: { type: "string", enum: ["POST"] } },
              required: ["method"],
            },
          },
        },
      },
    },
  },
};

app.use(stripeApiKeyMiddleware({ serviceName: "qr-code" }));

app.use(async (c, next) => {
  if (c.get("skipX402")) return next();
  return cdpPaymentMiddleware((env) => ({
    "POST /": { ...ROUTES["POST /"], accepts: ROUTES["POST /"].accepts.map((a: any) => ({ ...a, payTo: a.network.startsWith("solana") ? a.payTo : env.SERVER_ADDRESS as `0x${string}` })) },
  }))(c, next);
});

app.post("/", async (c) => {
  const body = await c.req.json<{ text?: string; size?: number }>();
  if (!body?.text) {
    return c.json({ error: "Missing 'text' field" }, 400);
  }

  const text = body.text.trim();
  if (!text) {
    return c.json({ error: "Missing 'text' field" }, 400);
  }

  let size = body.size ?? 256;
  if (isNaN(size) || size < 32) size = 256;
  if (size > 1024) size = 1024;

  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const cellSize = Math.max(1, Math.floor(size / (moduleCount + 8)));
  const svg = qr.createSvgTag({ cellSize, margin: cellSize * 4, scalable: true });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

app.get("/.well-known/openapi.json", openapiFromMiddleware("x402 QR Code", "qr.camelai.io", ROUTES));

app.get("/", (c) => {
  return c.json({
    service: "x402-qr-code",
    description: "Generate QR codes from text. Returns SVG. Send POST / with {\"text\": \"https://example.com\"}",
    price: "$0.001 per request (Base mainnet)",
  });
});

export default app;
