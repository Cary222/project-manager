import { NextRequest, NextResponse } from "next/server";

const TIMEOUT = 4000;

interface GeoResult {
  city: string | null;
  country: string | null;
}

async function fetchGeoInternational(ip: string): Promise<GeoResult> {
  const url = `http://ip-api.com/json/${ip}?fields=status,city,country&lang=zh`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ProjectHub/1.0" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`ip-api.com HTTP ${res.status}`);
  const data = (await res.json()) as { status: string; city: string; country: string };
  if (data.status !== "success" || !data.city) throw new Error(`ip-api.com failed: ${data.status}`);
  return { city: data.city ?? null, country: data.country ?? null };
}

async function fetchGeoChinese(ip: string): Promise<GeoResult> {
  const url = `https://ipinfo.io/${ip}/json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ProjectHub/1.0" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`ipinfo.io HTTP ${res.status}`);
  const data = (await res.json()) as { city?: string; country?: string; loc?: string };
  if (!data.city) throw new Error("ipinfo.io no city");
  return { city: data.city ?? null, country: data.country ?? null };
}

/**
 * 根据客户端 IP 返回地理位置（城市名）
 * 双链路兜底：国际服务（ip-api.com）优先，国内可访问服务（ipinfo.io）备用
 * 优先读 x-forwarded-for（VPN/代理场景），fallback 到 cf-connecting-ip
 */
export async function GET(request: NextRequest) {
  const forwardedIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("cf-connecting-ip") ??
    null;

  const debug: Record<string, unknown> & { attempts: Array<{ service: string; error: string }> } = {
    forwardedIp,
    attempts: [],
    city: null,
  };

  const isPrivateIp = (ip: string) =>
    !ip ||
    ip === "unknown" ||
    ip === "127.0.0.1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip.startsWith("172.");

  // private IP 时先尝试获取公网出口 IP（优先国内可访问服务）
  let publicIp: string | null = null;
  let myipResult: string | null = null;
  if (forwardedIp && isPrivateIp(forwardedIp)) {
    const ipServices = [
      "https://myip.ipip.net",     // 国内可访问，返回 "当前 IP：x  来自于：省 市 运营商"
      "https://ipinfo.io/ip",      // 国际可访问，只返回 IP 文本
    ];
    for (const svc of ipServices) {
      try {
        const res = await fetch(svc, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const text = (await res.text()).trim();

          if (svc.includes("myip.ipip.net")) {
            // myip.ipip.net 直接返回地点信息，格式：
            // "当前 IP：2409:...  来自于：中国 浙江 杭州  移动"
            // 同时解析出 IP 和城市
            const fromMatch = text.match(/来自于：(.+?)\s{2,}/);
            if (fromMatch) {
              myipResult = fromMatch[1].trim(); // e.g. "中国 浙江 杭州"
              const ipMatch = text.match(/当前 IP：([^\s]+)/);
              if (ipMatch) publicIp = ipMatch[1];
              if (myipResult) break;
            }
          } else {
            // ipinfo.io 直接返回 IP
            publicIp = text.replace(/^IP:\s*/, "").trim();
            if (publicIp) break;
          }
        }
      } catch { /* try next */ }
    }
    debug.myipResult = myipResult;
  }

  // myip.ipip.net 已直接返回地点，无需再调 geo 服务
  if (myipResult) {
    debug.city = myipResult;
    console.log("[GEO] success via myip.ipip.net:", JSON.stringify(debug));
    return NextResponse.json({ city: myipResult });
  }

  const ip = publicIp ?? forwardedIp ?? "unknown";
  debug.finalIp = ip;

  if (ip === "unknown") {
    console.log("[GEO]", JSON.stringify(debug));
    return NextResponse.json({ city: null, _debug: debug });
  }

  // 双链路：国际优先，国内兜底
  const geoServices: Array<{
    name: string;
    fn: (ip: string) => Promise<GeoResult>;
  }> = [
    { name: "ip-api.com", fn: fetchGeoInternational },
    { name: "ipinfo.io", fn: fetchGeoChinese },
  ];

  for (const svc of geoServices) {
    try {
      const geo = await svc.fn(ip);
      const cityStr = `${geo.city},${geo.country}`;
      debug.city = cityStr;
      console.log(`[GEO] success via ${svc.name}:`, JSON.stringify(debug));
      return NextResponse.json({ city: cityStr });
    } catch (e) {
      debug.attempts?.push({
        service: svc.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.log("[GEO] all services failed:", JSON.stringify(debug));
  return NextResponse.json({ city: null, _debug: debug });
}
