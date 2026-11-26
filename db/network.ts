import dns from "node:dns";
import net from "node:net";

/**
 * Opt-in workaround for networks with a broken IPv6 route (connections to
 * Neon time out with `AggregateError [ETIMEDOUT]`). Neon hostnames resolve
 * to several IPv6 addresses plus IPv4; when IPv6 is unreachable Node's
 * "happy eyeballs" can give up before trying IPv4.
 *
 * Set PG_FORCE_IPV4=1 in .env.local on affected machines only. Don't set it
 * in production (Vercel has working networking).
 */
export function applyNetworkWorkaround() {
  if (process.env.PG_FORCE_IPV4 !== "1") return;
  dns.setDefaultResultOrder("ipv4first");
  net.setDefaultAutoSelectFamily(false);
}
