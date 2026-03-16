const SUITS = ["♠", "♥", "♦", "♣"] as const;
const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;

export interface Card {
  suit: string;
  rank: string;
}

export interface BlackjackGame {
  playerHand: Card[];
  dealerHand: Card[];
  deck: Card[];
  channelId: string;
  createdAt: number;
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const sessions = new Map<string, BlackjackGame>();

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card: Card): number {
  if (card.rank === "A") return 11;
  if (["K", "Q", "J"].includes(card.rank)) return 10;
  return Number.parseInt(card.rank, 10);
}

export function handValue(hand: Card[]): number {
  let total = hand.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = hand.filter((c) => c.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function formatCard(card: Card): string {
  return `\`${card.rank}${card.suit}\``;
}

export function formatHand(hand: Card[]): string {
  return hand.map(formatCard).join(" ");
}

/** Session key combining user + channel so a user can only have one game per channel. */
function sessionKey(userId: string, channelId: string): string {
  return `${userId}:${channelId}`;
}

export function getGame(
  userId: string,
  channelId: string,
): BlackjackGame | undefined {
  const key = sessionKey(userId, channelId);
  const game = sessions.get(key);
  if (game && Date.now() - game.createdAt > SESSION_TIMEOUT_MS) {
    sessions.delete(key);
    return undefined;
  }
  return game;
}

export function createGame(userId: string, channelId: string): BlackjackGame {
  const key = sessionKey(userId, channelId);
  const deck = createDeck();
  const playerHand = [deck.pop()!, deck.pop()!];
  const dealerHand = [deck.pop()!, deck.pop()!];
  const game: BlackjackGame = {
    playerHand,
    dealerHand,
    deck,
    channelId,
    createdAt: Date.now(),
  };
  sessions.set(key, game);
  return game;
}

export function deleteGame(userId: string, channelId: string): void {
  sessions.delete(sessionKey(userId, channelId));
}

export function drawCard(game: BlackjackGame): Card {
  return game.deck.pop()!;
}

export function formatGameStatus(
  game: BlackjackGame,
  revealDealer: boolean,
): string {
  const playerVal = handValue(game.playerHand);
  const dealerDisplay = revealDealer
    ? `${formatHand(game.dealerHand)} (${handValue(game.dealerHand)})`
    : `${formatCard(game.dealerHand[0])} \`??\``;

  return (
    `**Dealer:** ${dealerDisplay}\n` +
    `**You:** ${formatHand(game.playerHand)} (${playerVal})`
  );
}
