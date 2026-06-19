export type Role = 'admin' | 'moderator' | 'student';
export type UserStatus = 'pending' | 'active' | 'disabled';
export type ProfileStatus = 'incomplete' | 'complete';
export type RatingType = 'standard' | 'rapid' | 'blitz';
export type EventType = RatingType;
export type EventFormat = 'individual' | 'team';
export type EventStatus = 'draft' | 'upcoming' | 'registration_open' | 'ongoing' | 'completed' | 'cancelled';
export type MedalType = 'gold' | 'silver' | 'bronze';
export type RegistrationStatus = 'selected' | 'submitted' | 'confirmed' | 'withdrawn';

export interface Account {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  profileStatus: ProfileStatus;
  missingFields: string[];
  fideId?: string;
  dateOfBirth?: string;
  phone?: string;
}

export interface PlayerRatingHistoryPoint {
  listMonth: string;
  standard?: number;
  standardGames?: number;
  rapid?: number;
  rapidGames?: number;
  blitz?: number;
  blitzGames?: number;
}

export interface Player {
  id: string;
  name: string;
  fideId?: string;
  dateOfBirth?: string;
  category: string;
  sex?: 'M' | 'F';
  standard: number;
  rapid: number;
  blitz: number;
  combined: number;
  active: boolean;
  profileStatus: ProfileStatus;
  missingFields: string[];
  ratingHistory?: PlayerRatingHistoryPoint[];
}

export interface MuralPost {
  id: string;
  tag: string;
  title: string;
  body: string;
  author: string;
  date: string;
  tint: string;
  rotation: string;
  x: number;
  y: number;
  z: number;
  imageUrl?: string;
}

export interface EventDeadline {
  label: string;
  value: string;
  date?: string;
  sourceUrl?: string;
}

export interface EventDocumentRecord {
  label: string;
  url: string;
}

export interface EventStartListEntry {
  number?: number;
  name: string;
  sourceId?: string;
  fideId?: string;
  federation?: string;
  rating?: number;
  club?: string;
  title?: string;
  category?: string;
  raw?: unknown;
}

export interface EventTeamStanding {
  position: number;
  seed?: number;
  name: string;
  played?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  matchPoints?: string;
  boardPoints?: string;
  tieBreaks?: string[];
  averageRating?: number;
  captain?: string;
  raw?: unknown;
}

export interface EventTeamMember {
  teamName: string;
  teamRank?: number;
  board?: number;
  title?: string;
  name: string;
  fideId?: string;
  federation?: string;
  rating?: number;
  points?: string;
  games?: number;
  performance?: number;
  raw?: unknown;
}

export interface ChessResultsImportField {
  label: string;
  status: 'found' | 'inferred' | 'defaulted' | 'missing';
  value?: string;
  note?: string;
}

export interface ChessResultsEventImport {
  sourceUrl: string;
  fetchedAt: string;
  name?: string;
  location?: string;
  dateLabel?: string;
  startsOn?: string;
  endsOn?: string;
  type?: EventType;
  format?: EventFormat;
  status?: EventStatus;
  season?: string;
  month?: string;
  participantsLabel?: string;
  chessResultsUrl?: string;
  chessResultsTnr?: string;
  regulationUrl?: string;
  deadlines: EventDeadline[];
  documents: EventDocumentRecord[];
  initialRanking: EventStartListEntry[];
  teamStandings?: EventTeamStanding[];
  teamMembers?: EventTeamMember[];
  fieldStatus?: Record<string, ChessResultsImportField>;
  warnings?: string[];
}

export interface TournamentPairing {
  board: number;
  white: string;
  black: string;
  whiteUs?: boolean;
  blackUs?: boolean;
  result?: string;
}

export interface TournamentStanding {
  position: number;
  name: string;
  club: string;
  points: string;
  fideId?: string;
  us?: boolean;
  team?: boolean;
  seed?: number;
  played?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  matchPoints?: string;
  boardPoints?: string;
  tieBreaks?: string[];
}

export interface EventRegistrationRecord {
  playerId: string;
  status: RegistrationStatus;
  notes?: string;
}

export interface TournamentLive {
  round: number;
  totalRounds: number;
  nextRound: string;
  pairings: TournamentPairing[];
  standings: TournamentStanding[];
}

export interface ResultAthlete {
  name: string;
  score: string;
  performance?: string;
  delta?: string;
}

export interface EventResult {
  summary: string;
  leadExternalPlayers?: number;
  athletes: ResultAthlete[];
}

export interface EventRecord {
  id: string;
  season: string;
  month: string;
  dateLabel: string;
  startsOn?: string;
  endsOn?: string;
  name: string;
  location: string;
  type: EventType;
  format?: EventFormat;
  distanceKm: number;
  participantsLabel: string;
  status: EventStatus;
  chessResultsUrl: string;
  regulationUrl?: string;
  provisional?: boolean;
  recommended?: boolean;
  deadlines: EventDeadline[];
  documents?: EventDocumentRecord[];
  initialRanking?: EventStartListEntry[];
  teamStandings?: EventTeamStanding[];
  teamMembers?: EventTeamMember[];
  result?: EventResult;
  live?: TournamentLive;
  registrations: string[];
  registrationDetails?: EventRegistrationRecord[];
}

export interface Medal {
  id: string;
  eventId: string;
  playerId: string;
  type: MedalType;
  source: 'auto' | 'manual';
  place?: number;
  label?: string;
}

export interface GameRecord {
  id: string;
  white: string;
  black: string;
  event: string;
  result: string;
  eco: string;
  moves: string[];
  annotations: Record<number, string>;
  pgn?: string;
  playedOn?: string;
  whitePlayerId?: string;
  blackPlayerId?: string;
}

export interface WorkerRun {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  message: string;
  updatedAt: string;
  result?: unknown;
  payload?: unknown;
  attempts?: number;
}

export interface AppData {
  accounts: Account[];
  players: Player[];
  posts: MuralPost[];
  events: EventRecord[];
  medals: Medal[];
  games: GameRecord[];
  workerRuns: WorkerRun[];
}
