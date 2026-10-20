/**
 * Server-only persistence for verified Brevo webhooks.
 *
 * The elevated client is created per request. The handler has already verified
 * the bearer secret and normalised the event before this module is called.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { EmailRepositoryError } from "./outbox-repository";
import {
  outboxIdFromCustomHeader,
  type BrevoDeliveryRecord,
  type BrevoWebhookRepository,
} from "./webhook";

type OutboxIdRow = { id: string };

export function createBrevoWebhookRepository(): BrevoWebhookRepository {
  return {
    async findOutboxId(input): Promise<string | null> {
      const client = createSupabaseAdminClient();

      // Prefer the opaque header added at send time. It lets a webhook that
      // arrives before mark_sent still resolve to the right outbox row.
      const customId = outboxIdFromCustomHeader(input.customHeader);
      if (customId) {
        const { data, error } = await client
          .from("email_outbox")
          .select("id")
          .eq("id", customId)
          .maybeSingle();
        if (error) throw new EmailRepositoryError();
        if (data) return (data as OutboxIdRow).id;
      }

      if (!input.providerMessageId) return null;

      const { data, error } = await client
        .from("email_outbox")
        .select("id")
        .eq("provider_message_id", input.providerMessageId)
        .limit(1)
        .maybeSingle();

      if (error) throw new EmailRepositoryError();
      if (!data) return null;
      return (data as OutboxIdRow).id;
    },

    async record(
      input: BrevoDeliveryRecord,
    ): Promise<"recorded" | "duplicate"> {
      const client = createSupabaseAdminClient();
      const { error } = await client.from("email_delivery_events").insert({
        outbox_id: input.outboxId,
        event: input.event,
        dedupe_key: input.dedupeKey,
        reason: input.reason,
        provider_event_at: input.providerEventAt,
      });

      if (!error) return "recorded";
      if (error.code === "23505") return "duplicate";
      throw new EmailRepositoryError();
    },
  };
}
