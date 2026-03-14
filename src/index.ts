import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { stripeApiKeyMiddleware } from "x402-stripe";
import { extractParams } from "x402-ai";
import { openapiFromMiddleware } from "x402-openapi";
import qrcode from "qrcode-generator";

const app = new Hono<{ Bindings: Env }>();

const SYSTEM_PROMPT = `You are a parameter extractor for a QR code generation service.
Extract the following from the user's message and return JSON:
- "text": the text or URL to encode in the QR code (required)
- "size": the size in pixels, between 32 and 1024, default 256 (optional)

Return ONLY valid JSON, no explanation.
Examples:
- {"text": "https://example.com"}
- {"text": "Hello World", "size": 512}`;

const ROUTES = {
  "POST /": {
    accepts: [{ scheme: "exact", price: "$0.001", network: "eip155:8453", payTo: "0x0" as `0x${string}` }],
    description: "Generate a QR code from text or URL. Send {\"input\": \"your request\"}",
    mimeType: "image/svg+xml",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: {
              input: { type: "string", description: "Describe what you want to encode as a QR code", required: true },
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
    "POST /": { ...ROUTES["POST /"], accepts: [{ ...ROUTES["POST /"].accepts[0], payTo: env.SERVER_ADDRESS as `0x${string}` }] },
  }))(c, next);
});

app.post("/", async (c) => {
  const body = await c.req.json<{ input?: string }>();
  if (!body?.input) {
    return c.json({ error: "Missing 'input' field" }, 400);
  }

  const params = await extractParams(c.env.CF_GATEWAY_TOKEN, SYSTEM_PROMPT, body.input);
  const text = params.text as string;
  if (!text) {
    return c.json({ error: "Could not determine text to encode" }, 400);
  }

  let size = parseInt(String(params.size || "256"), 10);
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
    description: "Generate QR codes from text. Returns SVG. Send POST / with {\"input\": \"encode https://example.com as a QR code\"}",
    price: "$0.001 per request (Base mainnet)",
  });
});

export default app;
