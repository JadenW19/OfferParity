import dns from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import net from "node:net";

export type DnsLookupFn = (
  hostname: string,
  options: LookupAllOptions
) => Promise<LookupAddress[]>;

/**
 * Error thrown when a target URL or any resolved/redirected address violates SSRF policy.
 */
export class SsrfBlockedError extends Error {
  readonly code = "SSRF_BLOCKED" as const;
  readonly reason: string;

  constructor(reason: string) {
    super(`Blocked unsafe URL: ${reason}`);
    this.name = "SsrfBlockedError";
    this.reason = reason;
  }
}

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"] as const;

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

function inIpv4Cidr(ipInt: number, baseInt: number, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_IPV4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  [ipv4ToUint32("0.0.0.0")!, 8], // Unspecified / "this network"
  [ipv4ToUint32("10.0.0.0")!, 8], // RFC1918
  [ipv4ToUint32("100.64.0.0")!, 10], // CGNAT (RFC6598)
  [ipv4ToUint32("127.0.0.0")!, 8], // Loopback
  [ipv4ToUint32("169.254.0.0")!, 16], // Link-local & cloud metadata
  [ipv4ToUint32("172.16.0.0")!, 12], // RFC1918
  [ipv4ToUint32("192.168.0.0")!, 16], // RFC1918
  [ipv4ToUint32("224.0.0.0")!, 4], // Multicast
  [ipv4ToUint32("240.0.0.0")!, 4], // Reserved / broadcast
];

function isBlockedIpv4(ip: string): boolean {
  const ipInt = ipv4ToUint32(ip);
  if (ipInt === null) {
    return true;
  }
  return BLOCKED_IPV4_CIDRS.some(([base, prefix]) =>
    inIpv4Cidr(ipInt, base, prefix)
  );
}

/**
 * Parse an IPv6 string (including IPv4-embedded forms like ::ffff:127.0.0.1)
 * into eight 16-bit hextets. Returns null if malformed.
 */
function expandIpv6Hextets(rawIp: string): number[] | null {
  const zoneIdx = rawIp.indexOf("%");
  if (zoneIdx !== -1) {
    return null;
  }

  let ip = rawIp.toLowerCase();
  const lastColon = ip.lastIndexOf(":");
  const maybeIpv4 = lastColon !== -1 ? ip.slice(lastColon + 1) : "";
  if (maybeIpv4.includes(".")) {
    const ipv4Int = ipv4ToUint32(maybeIpv4);
    if (ipv4Int === null) {
      return null;
    }
    const hi = ((ipv4Int >>> 16) & 0xffff).toString(16);
    const lo = (ipv4Int & 0xffff).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonParts = ip.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  const parseGroup = (segment: string): number[] | null => {
    if (!segment) {
      return [];
    }
    const parts = segment.split(":");
    const result: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) {
        return null;
      }
      result.push(parseInt(part, 16));
    }
    return result;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseGroup(doubleColonParts[0] ?? "");
    if (!groups || groups.length !== 8) {
      return null;
    }
    return groups;
  }

  const left = parseGroup(doubleColonParts[0] ?? "");
  const right = parseGroup(doubleColonParts[1] ?? "");
  if (!left || !right) {
    return null;
  }
  const missing = 8 - (left.length + right.length);
  if (missing < 1) {
    return null;
  }
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function hextetsToIpv4Int(h6: number, h7: number): number {
  return (((h6 & 0xffff) << 16) | (h7 & 0xffff)) >>> 0;
}

function isBlockedIpv6(ip: string): boolean {
  const hextets = expandIpv6Hextets(ip);
  if (!hextets || hextets.length !== 8) {
    return true;
  }

  const h0 = hextets[0]!;
  const h1 = hextets[1]!;
  const h2 = hextets[2]!;
  const h3 = hextets[3]!;
  const h4 = hextets[4]!;
  const h5 = hextets[5]!;
  const h6 = hextets[6]!;
  const h7 = hextets[7]!;

  const allPrefixZero =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;

  // ::/128 (unspecified) and ::1/128 (loopback)
  if (allPrefixZero && h5 === 0 && h6 === 0 && (h7 === 0 || h7 === 1)) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96)
  if (allPrefixZero && h5 === 0xffff) {
    const ipv4Int = hextetsToIpv4Int(h6, h7);
    return BLOCKED_IPV4_CIDRS.some(([base, prefix]) =>
      inIpv4Cidr(ipv4Int, base, prefix)
    );
  }

  // Deprecated IPv4-compatible IPv6 (::0:0/96)
  if (allPrefixZero && h5 === 0) {
    const ipv4Int = hextetsToIpv4Int(h6, h7);
    return BLOCKED_IPV4_CIDRS.some(([base, prefix]) =>
      inIpv4Cidr(ipv4Int, base, prefix)
    );
  }

  // Unique-local addresses (fc00::/7)
  if ((h0 & 0xfe00) === 0xfc00) {
    return true;
  }

  // Link-local unicast (fe80::/10)
  if ((h0 & 0xffc0) === 0xfe80) {
    return true;
  }

  // Multicast (ff00::/8)
  if ((h0 & 0xff00) === 0xff00) {
    return true;
  }

  return false;
}

/**
 * Return true if an IPv4 or IPv6 address falls inside a blocked private,
 * loopback, link-local, CGNAT, unique-local, or reserved range.
 */
export function isBlockedIpAddress(address: string): boolean {
  const clean = address.replace(/^\[|\]$/g, "").trim();
  const version = net.isIP(clean);
  if (version === 4) {
    return isBlockedIpv4(clean);
  }
  if (version === 6) {
    return isBlockedIpv6(clean);
  }
  return true;
}

/**
 * Validate that a target URL uses http/https, has no embedded credentials,
 * does not reference local/internal domains, and resolves exclusively to
 * public non-reserved IP addresses.
 */
export async function assertSafeUrl(
  rawUrl: string,
  lookupFn: DnsLookupFn = dns.lookup
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("Malformed URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(
      `Unsupported protocol "${parsed.protocol}" (only http: and https: are allowed)`
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new SsrfBlockedError("Embedded URL credentials are not allowed");
  }

  const rawHost = parsed.hostname;
  if (!rawHost) {
    throw new SsrfBlockedError("URL hostname is empty");
  }

  const cleanHost = rawHost
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();

  if (!cleanHost) {
    throw new SsrfBlockedError("URL hostname is empty");
  }

  if (cleanHost.includes("%")) {
    throw new SsrfBlockedError("Zone identifiers in hostnames are not allowed");
  }

  if (
    cleanHost === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => cleanHost.endsWith(suffix))
  ) {
    throw new SsrfBlockedError(`Restricted hostname "${cleanHost}"`);
  }

  const ipVersion = net.isIP(cleanHost);
  if (ipVersion !== 0) {
    if (isBlockedIpAddress(cleanHost)) {
      throw new SsrfBlockedError(`Private or reserved IP literal "${cleanHost}"`);
    }
    return parsed;
  }

  const addresses = await lookupFn(cleanHost, { all: true });
  if (!addresses || addresses.length === 0) {
    throw new SsrfBlockedError(`Hostname "${cleanHost}" resolved to no addresses`);
  }

  for (const record of addresses) {
    if (!record.address || isBlockedIpAddress(record.address)) {
      throw new SsrfBlockedError(
        `Hostname "${cleanHost}" resolved to restricted IP "${record.address}"`
      );
    }
  }

  return parsed;
}
