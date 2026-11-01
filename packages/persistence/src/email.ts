/**
 * Email delivery.
 *
 * No mail provider is configured, so nothing is actually sent. The outbox
 * deliverer writes the message to a table and returns `delivered: false`,
 * which is the truth.
 *
 * A silent no-op would have been less code and would have looked like a
 * working product right up until a real customer never received anything.
 * Returning `delivered: false` means the interface cannot be mistaken for a
 * working one, and the caller has to decide what to tell the user.
 */
import { type Db, newId } from './db.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface DeliveryResult {
  /** False whenever nothing actually left the building. */
  delivered: boolean;
  via: string;
  /** Where to find it when it was not really sent. */
  outboxId?: string;
}

export interface EmailDeliverer {
  readonly name: string;
  readonly reallySends: boolean;
  send(message: EmailMessage): Promise<DeliveryResult>;
}

/**
 * Writes to `email_outbox` and the console. For development, and for making
 * it obvious in a demo that mail is not configured.
 */
export class OutboxDeliverer implements EmailDeliverer {
  readonly name = 'outbox';
  readonly reallySends = false;

  private readonly db: Db;
  private readonly log: boolean;

  constructor(db: Db, options: { log?: boolean } = {}) {
    this.db = db;
    this.log = options.log ?? true;
  }

  async send(message: EmailMessage): Promise<DeliveryResult> {
    const id = newId('mail');

    this.db
      .prepare(
        `INSERT INTO email_outbox (id, to_email, subject, body, delivered_via, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, message.to, message.subject, message.body, this.name, new Date().toISOString());

    if (this.log) {
      console.log(
        `\n[email:outbox] NOT SENT — no mail provider configured.\n` +
          `  to:      ${message.to}\n` +
          `  subject: ${message.subject}\n` +
          `  ${message.body.split('\n').join('\n  ')}\n`
      );
    }

    return { delivered: false, via: this.name, outboxId: id };
  }
}

/** Reads the outbox. Exists so a test, or a developer, can see what was written. */
export function readOutbox(db: Db, email: string, limit = 10) {
  return db
    .prepare(
      `SELECT id, to_email, subject, body, delivered_via, created_at
         FROM email_outbox
        WHERE to_email = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?`
    )
    .all(email.trim().toLowerCase(), limit) as Array<{
    id: string;
    to_email: string;
    subject: string;
    body: string;
    delivered_via: string;
    created_at: string;
  }>;
}

export const signInEmail = (
  code: string,
  minutes: number
): Omit<EmailMessage, 'to'> => ({
  subject: 'Your sign-in code',
  body:
    `Your sign-in code is ${code}\n\n` +
    `It expires in ${minutes} minutes and can only be used once.\n\n` +
    `If you did not ask to sign in, you can ignore this — the code is useless ` +
    `without your email inbox, and nobody has been given access to anything.`,
});
