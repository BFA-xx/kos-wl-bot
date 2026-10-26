-- In-Telegram wallet entry: a private-chat step that asks for one address.
ALTER TYPE "TelegramConversationKind" ADD VALUE IF NOT EXISTS 'WALLET_ADDRESS';
