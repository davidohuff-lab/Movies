import { cookies } from "next/headers";

const ADMIN_COOKIE = "projection-room";

export function isAdminAuthenticated(): boolean {
  return cookies().get(ADMIN_COOKIE)?.value === "1";
}

export function getAdminSecret(): string {
  return process.env.ADMIN_SECRET || "projectionist";
}

export function getAdminCookieName(): string {
  return ADMIN_COOKIE;
}
