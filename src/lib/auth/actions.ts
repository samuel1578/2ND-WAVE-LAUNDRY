"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  isSupabaseConfigured,
  supabaseConfig,
  supabaseConfigMessage,
} from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reconcileInvitationForUser } from "@/lib/admin/staff-service";
import { getCurrentAdmin } from "./admin";
import { resolveLoginDestination } from "./permissions";
import { resolveAuthOrigin } from "./redirect";
import { MIN_ADMIN_PASSWORD_LENGTH } from "./roles";

/**
 * Administrator authentication server actions.
 *
 * Security notes:
 * - Every action fails closed when Supabase configuration is missing.
 * - Authentication failures return one generic message, so the login screen
 *   never reveals whether an arbitrary email address belongs to an
 *   administrator.
 * - Nothing here logs credentials, tokens or provider error bodies, and no
 *   privileged credential is read.
 * - These actions only ever operate on the caller's own session.
 */

const SIGN_IN_FAILED =
  "Those sign-in details were not accepted. Check your email address and password, then try again.";
const MISSING_FIELDS = "Enter your email address and password.";
const RESET_LINK_INVALID =
  "This password reset link is no longer valid. Request a new link and try again.";
const ORIGIN_UNAVAILABLE =
  "Password reset is unavailable: this site origin is not in the configured authentication redirect allow-list.";

export type SignInResult = { error: string };
export type PasswordResetResult = { sent: true } | { error: string };
export type PasswordUpdateResult = { ok: true } | { error: string };

function configurationError(): string {
  return supabaseConfig.ok
    ? "Administrator authentication is unavailable."
    : supabaseConfigMessage(supabaseConfig.reason);
}

async function currentAuthOrigin(): Promise<string | null> {
  const requestHeaders = await headers();
  return resolveAuthOrigin({
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    protocol: requestHeaders.get("x-forwarded-proto"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
}

/**
 * Email and password sign-in. Requires an active `admin_profiles` row; a
 * successful password check alone grants nothing. A session that authenticates
 * but has no administrator profile is ended immediately.
 *
 * A requested return path is honoured only when the resolved role may reach it;
 * otherwise the role's landing page is used (Full Admin: `/admin`, Operational
 * Admin: `/admin/bookings`).
 */
export async function signInAdmin(input: {
  email: string;
  password: string;
  next?: string;
}): Promise<SignInResult> {
  if (!isSupabaseConfigured) return { error: configurationError() };
  const email = input.email.trim();
  if (!email || !input.password) return { error: MISSING_FIELDS };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: input.password,
  });
  if (error || !data.user) return { error: SIGN_IN_FAILED };

  let admin = await getCurrentAdmin();
  if (!admin) {
    // Sprint 1C: an invited administrator may be signing in before their profile
    // existed (for example after setting a password). Completing an outstanding
    // invitation for this verified address creates the profile from the invited
    // role; it is idempotent and never grants a role that was not invited.
    await reconcileInvitationForUser({
      id: data.user.id,
      email: data.user.email,
      correlationId: crypto.randomUUID(),
    }).catch(() => undefined);
    admin = await getCurrentAdmin();
  }

  if (!admin) {
    // Disabled account, missing profile or unreadable profile: end the session.
    await supabase.auth.signOut();
    return { error: SIGN_IN_FAILED };
  }

  redirect(resolveLoginDestination(admin.role, input.next));
}

/** Ends the Supabase session for this browser and returns to the login screen. */
export async function signOutAdmin(): Promise<void> {
  if (isSupabaseConfigured) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/admin/login");
}

/**
 * Requests a recovery email. The response is deliberately identical whether or
 * not the address is an administrator account.
 */
export async function requestAdminPasswordReset(input: {
  email: string;
}): Promise<PasswordResetResult> {
  if (!isSupabaseConfigured) return { error: configurationError() };
  const email = input.email.trim();
  if (!email) return { error: "Enter your email address." };

  const origin = await currentAuthOrigin();
  if (!origin) return { error: ORIGIN_UNAVAILABLE };

  const supabase = await createSupabaseServerClient();
  // Errors are intentionally not surfaced and never forwarded to the browser.
  await supabase.auth
    .resetPasswordForEmail(email, { redirectTo: `${origin}/admin/auth/callback` })
    .catch(() => undefined);

  return { sent: true };
}

/**
 * Completes a password recovery. Requires a session created by the recovery
 * callback, so an expired or reused link is rejected. No administrator profile
 * is created or promoted here.
 */
export async function updateAdminPassword(input: {
  password: string;
  confirm: string;
}): Promise<PasswordUpdateResult> {
  if (!isSupabaseConfigured) return { error: configurationError() };
  if (input.password.length < MIN_ADMIN_PASSWORD_LENGTH)
    return {
      error: `Use at least ${MIN_ADMIN_PASSWORD_LENGTH} characters for your new password.`,
    };
  if (input.password !== input.confirm)
    return { error: "Your passwords do not match." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: RESET_LINK_INVALID };

  // The account must already be an active administrator. Recovery never grants
  // access, and never creates a profile.
  const admin = await getCurrentAdmin();
  if (!admin) return { error: RESET_LINK_INVALID };

  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) return { error: RESET_LINK_INVALID };

  redirect("/admin?notice=password-updated");
}
