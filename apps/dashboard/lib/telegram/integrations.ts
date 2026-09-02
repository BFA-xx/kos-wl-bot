/**
 * Stable event contracts for optional KOS ecosystem integrations. Telegram
 * owns no Mintooor business logic and consumers remain independently deployable.
 */
export type KosTelegramIntegrationEvent =
  | {
      type: "identity.onboarded";
      identityId: string;
      telegramUserId: string;
      occurredAt: string;
    }
  | {
      type: "raffle.entered" | "raffle.won";
      identityId: string;
      raffleId: number;
      occurredAt: string;
    }
  | {
      type: "community.joined";
      identityId: string | null;
      communityId: string;
      telegramUserId: string;
      occurredAt: string;
    };

export interface KosEcosystemIntegration {
  readonly name: string;
  readonly enabled: boolean;
  publish(event: KosTelegramIntegrationEvent): Promise<void>;
}

export interface MintooorIntegration extends KosEcosystemIntegration {
  readonly name: "mintooor";
}
