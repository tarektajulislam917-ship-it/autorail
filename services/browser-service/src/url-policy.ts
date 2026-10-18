import dns from "node:dns/promises";
import net from "node:net";

const blockedHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "host.docker.internal",
  "gateway.docker.internal",
  "metadata.google.internal"
]);

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("::ffff:") && isBlockedIpv4(normalized.slice(7))
  );
}

export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);
  return version === 4 ? isBlockedIpv4(address) : version === 6 ? isBlockedIpv6(address) : true;
}

export async function validatePublicUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed.");
  if (!url.hostname || url.hostname.endsWith(".local") || blockedHostnames.has(url.hostname.toLowerCase())) {
    throw new Error("Local and private hosts are not allowed.");
  }

  const literalVersion = net.isIP(url.hostname);
  if (literalVersion && isBlockedAddress(url.hostname)) throw new Error("Private and reserved IP addresses are not allowed.");

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Host could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("Host resolves to a private or reserved address.");
  }

  return url;
}
