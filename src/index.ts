import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { x402Routes } from "x402-openapi";
import qrcode from "qrcode-generator";

const app = new Hono<{ Bindings: Env }>();

// === Define routes once ===
const routes = x402Routes({
  "GET /generate": {
    price: "$0.001",
    description: "Generate a QR code from text",
    mimeType: "image/svg+xml",
    query: {
      text: { type: "string", description: "Text or URL to encode in the QR code", required: true },
      size: { type: "integer", description: "Size in pixels (default 256, max 1024)", maximum: 1024, default: 256 },
    },
    responses: {
      200: { description: "SVG QR code image", content: { "image/svg+xml": { schema: { type: "string" } } } },
      400: { description: "Missing or invalid parameters" },
    },
  },
});

// OpenAPI spec (freely accessible)
app.get("/.well-known/openapi.json", routes.openapi(app, {
  title: "x402 QR Code Generator",
  description: "Generate QR codes from text",
  server: "qr.camelai.io",
}));

// x402 payment gate (Bazaar inputSchema auto-generated from route defs above)
app.use(cdpPaymentMiddleware((env) => routes.paymentConfig(env.SERVER_ADDRESS as `0x${string}`)));

// Route handler (OpenAPI description auto-generated from route defs above)
app.get("/generate", routes.describe("GET /generate"), async (c) => {
  const text = c.req.query("text");
  if (!text) {
    return c.json({ error: "Missing 'text' query parameter" }, 400);
  }

  let size = parseInt(c.req.query("size") || "256", 10);
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

// Health check
app.get("/", (c) => {
  return c.json({
    service: "x402-qr-code",
    description: "Generate QR codes from text. Returns SVG.",
    endpoint: "GET /generate?text=hello&size=256",
    price: "$0.001 per request (Base mainnet)",
  });
});

export default app;
