import { NextRequest, NextResponse } from "next/server";

// Optional: force Node.js runtime for larger responses/timeouts
export const runtime = "nodejs";

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    host.endsWith(".local")
  );
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 }
    );
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(upstreamUrl.protocol)) {
    return NextResponse.json({ error: "Invalid protocol" }, { status: 400 });
  }

  if (isPrivateHost(upstreamUrl.hostname)) {
    return NextResponse.json(
      { error: "Access to local URLs not allowed" },
      { status: 403 }
    );
  }

  // Proxy the request
  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(upstreamUrl.toString(), {
      headers: {
        "User-Agent": "EditorProxy/1.0",
        Accept: request.headers.get("accept") || "*/*",
        "Accept-Language":
          request.headers.get("accept-language") || "en-US,en;q=0.5",
        Referer: upstreamUrl.origin,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Upstream fetch error" },
      { status: 502 }
    );
  }

  if (!upstreamResp.ok) {
    return NextResponse.json(
      { error: `Upstream ${upstreamResp.status}` },
      { status: upstreamResp.status }
    );
  }

  // For simplicity, buffer response (acceptable for moderate files). Add size guard.
  const contentType =
    upstreamResp.headers.get("content-type") || "application/octet-stream";
  const buf = await upstreamResp.arrayBuffer();
  if (buf.byteLength > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, immutable",
      // Critical for COEP environments to allow embedding
      "Cross-Origin-Resource-Policy": "cross-origin",
      // Helpful
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
