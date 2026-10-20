/**
 * Best-effort post-commit email dispatch.
 *
 * Called through Next.js `after()` so it runs after the booking response has
 * been produced, never inside the booking transaction. It swallows every failure:
 * a provider outage or missing configuration must never affect booking creation,
 * confirmation or a status update.
 *
 * This is not the reliability mechanism. A scheduled worker (see the sprint
 * report) must also drain pending/retryable rows after restarts and failures.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { createBrevoClient } from "./brevo";
import {
  emailConfigMessage,
  readTransactionalEmailConfig,
} from "./config";
import { createEmailOutboxRepository } from "./outbox-repository";
import { runEmailWorker } from "./worker";

export async function dispatchPendingEmails(source: string): Promise<void> {
  try {
    const config = readTransactionalEmailConfig();
    if (!config.ok) {
      console.warn(
        `[email] dispatch skipped source=${source} reason=${config.reason} detail=${emailConfigMessage(config.reason, config.templateVariable)}`,
      );
      return;
    }

    const repository = createEmailOutboxRepository();
    const provider = createBrevoClient({
      apiKey: config.config.apiKey,
      senderEmail: config.config.senderEmail,
      senderName: config.config.senderName,
    });

    const summary = await runEmailWorker(
      {
        enabled: true,
        repository,
        provider,
        siteUrl: config.config.siteUrl,
        templateIds: config.config.templateIds,
        // Keep the post-response task short on serverless hosts. The protected
        // endpoint remains able to drain a larger batch.
        batchSize: 3,
      },
      { workerId: `post-commit-${randomUUID()}` },
    );

    if (!summary.ok) {
      console.warn(
        `[email] dispatch unavailable source=${source} error=${summary.error}`,
      );
      return;
    }

    // Operational counts only: never a recipient, reference or provider payload.
    if (summary.retried > 0 || summary.dead > 0 || summary.failed > 0) {
      console.warn(
        `[email] delivery attention source=${source} claimed=${summary.claimed} sent=${summary.sent} retried=${summary.retried} dead=${summary.dead} skipped=${summary.skipped} failed=${summary.failed}`,
      );
    }
  } catch {
    // Deliberately silent except for a stable message: no customer data and no
    // credential can be disclosed by a dispatch failure.
    console.warn(`[email] dispatch failed source=${source}`);
  }
}
