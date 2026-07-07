import { cookies } from "next/headers";

const ADMIN_COOKIE = "projection-room";

export function isAdminAuthenticated(): boolean {
  return isAdminCookieAuthorized(cookies().get(ADMIN_COOKIE)?.value);
}

export function getAdminSecret(): string {
  return process.env.ADMIN_SECRET || "projectionist";
}

export function getAdminCookieName(): string {
  return ADMIN_COOKIE;
}

export function isAdminCookieAuthorized(value: string | undefined): boolean {
  return value === "1";
}
