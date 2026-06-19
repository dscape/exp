"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { normalizeBirthDate, todayIsoDate } from "@/lib/dates";
import { isChessResultsUrl as isChessResultsUrlInput } from "@/lib/chess-results-url";
import {
  appendEventFilterSearch,
  eventFiltersFromSearch,
  EVENT_FILTER_SEASONS,
  eventsRouteForFilters,
  type EventFilterState,
  type EventStatusFilter,
} from "@/lib/event-filters";
import {
  buildFideRankingRows,
  groupFideRankingRows,
  ratingAtOrBefore,
  type FideRankingRow,
} from "@/lib/fide-rankings";
import { buildPgnDatabase } from "@/lib/pgn";
import {
  findTournamentPlayer,
  isEfanorClub,
  normalizeFideId,
  normalizePersonName,
  type TournamentEntry,
} from "@/lib/tournament-matching";
import type {
  Account,
  AppData,
  ChessResultsEventImport,
  ChessResultsImportField,
  EventRecord,
  EventRegistrationRecord,
  EventStartListEntry,
  EventStatus,
  EventTeamMember,
  EventTeamStanding,
  EventType,
  GameRecord,
  Medal,
  MedalType,
  MuralPost,
  Player,
  RatingType,
  Role,
  WorkerRun,
} from "@/lib/types";

type Screen = "login" | "request" | "app";
type View =
  | "mural"
  | "eventos"
  | "evento"
  | "fide"
  | "jogador"
  | "partida"
  | "trofeus"
  | "gestao";

type ComposeState = {
  title: string;
  body: string;
  tint: string;
  imageUrl?: string;
};
type EventForm = {
  name: string;
  location: string;
  dateLabel: string;
  startsOn: string;
  endsOn: string;
  url: string;
  regulationUrl: string;
  type: EventType;
  status: EventStatus;
  season: string;
  month: string;
  deadline: string;
};

type EventImportState =
  | { status: "idle" }
  | { status: "loading"; jobId?: string }
  | { status: "ready"; data: ChessResultsEventImport }
  | { status: "error"; message: string };
type EventSyncState = {
  status: "syncing" | "debounced" | "succeeded" | "failed";
  message?: string;
  jobId?: string;
  automatic?: boolean;
};
type StatusFilter = EventStatusFilter;
type RequestForm = {
  studentName: string;
  dateOfBirth: string;
  fideId: string;
  guardianEmail: string;
  phone: string;
  password: string;
  confirmPassword: string;
  message: string;
};
type AwardState = {
  eventId: string;
  playerId: string;
  playerName: string;
  type: Extract<MedalType, "gold" | "silver" | "bronze">;
  label: string;
  teamName?: string;
} | null;
type EditState = {
  accountId: string;
  name: string;
  email: string;
  fideId: string;
  dateOfBirth: string;
  phone: string;
  temporaryPassword: string;
} | null;

type PgnUploadState = {
  playerId: string;
  eventName: string;
  playedOn: string;
  white: string;
  black: string;
  result: string;
  eco: string;
  file?: File;
} | null;

const NAV = [
  ["mural", "Mural", "♟"],
  ["eventos", "Eventos", "♜"],
  ["fide", "Ratings FIDE", "♛"],
  ["trofeus", "Troféus", "★"],
  ["gestao", "Gestão", "♚"],
] as const;

const VIEW_META: Record<View, [string, string]> = {
  mural: ["Mural", "Avisos e recados do clube"],
  eventos: ["Eventos", "Calendário e provas da época"],
  evento: ["Evento", "Detalhe da prova"],
  fide: ["Ratings FIDE", "Leaderboard mensal do clube"],
  jogador: ["Atleta", "Perfil e evolução"],
  partida: ["Análise", "Partida anotada lance a lance"],
  trofeus: ["Sala de Troféus", "Todas as conquistas dos nossos atletas"],
  gestao: ["Gestão", "Contas, acessos e palavras-passe"],
};

const TYPE_LABEL: Record<EventType, string> = {
  standard: "Clássicas",
  rapid: "Semi-Rápidas",
  blitz: "Rápidas",
};
const TYPE_SHORT: Record<EventType, string> = {
  standard: "CL",
  rapid: "SR",
  blitz: "RA",
};
const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Rascunho",
  upcoming: "Próximo",
  registration_open: "Inscrições abertas",
  ongoing: "A decorrer",
  completed: "Concluído",
  cancelled: "Cancelado",
};
const REGISTRATION_STATUS_LABEL: Record<
  EventRegistrationRecord["status"],
  string
> = {
  selected: "Selecionado",
  submitted: "Enviado",
  confirmed: "Confirmado",
  withdrawn: "Retirado",
};
const SEASONS = EVENT_FILTER_SEASONS;
const MONTHS = [
  "SET",
  "OUT",
  "NOV",
  "DEZ",
  "JAN",
  "FEV",
  "MAR",
  "ABR",
  "MAI",
  "JUN",
  "JUL",
  "AGO",
];
const FIDE_MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const FIDE_SHORT_MONTH_LABELS = [
  "JAN",
  "FEV",
  "MAR",
  "ABR",
  "MAI",
  "JUN",
  "JUL",
  "AGO",
  "SET",
  "OUT",
  "NOV",
  "DEZ",
];
const TINTS = [
  "#FCEBC4",
  "#FBD3CE",
  "#CFE0F3",
  "#D6E9C6",
  "#F0D7E6",
  "#F6E7B6",
];

let cachedSessionAccount: Account | null | undefined;

const PIECES: Record<string, string> = {
  wK: "♔",
  wQ: "♕",
  wR: "♖",
  wB: "♗",
  wN: "♘",
  wP: "♙",
  bK: "♚",
  bQ: "♛",
  bR: "♜",
  bB: "♝",
  bN: "♞",
  bP: "♟",
};
const MOVE_COORDS = [
  ["e2", "e4"],
  ["e7", "e5"],
  ["g1", "f3"],
  ["d7", "d6"],
  ["d2", "d4"],
  ["c8", "g4"],
  ["d4", "e5"],
  ["g4", "f3"],
  ["d1", "f3"],
  ["d6", "e5"],
  ["f1", "c4"],
  ["g8", "f6"],
  ["f3", "b3"],
  ["d8", "e7"],
  ["b1", "c3"],
  ["c7", "c6"],
  ["c1", "g5"],
  ["b7", "b5"],
  ["c3", "b5"],
  ["c6", "b5"],
  ["c4", "b5"],
  ["b8", "d7"],
  ["e1", "c1"],
  ["a8", "d8"],
  ["d1", "d7"],
  ["d8", "d7"],
  ["h1", "d1"],
  ["e7", "e6"],
  ["b5", "d7"],
  ["f6", "d7"],
  ["b3", "b8"],
  ["d7", "b8"],
  ["d1", "d8"],
] as const;

export default function ClubApp({ initialData }: { initialData: AppData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const eventFilterSearch = searchParams.toString();
  const eventFilters = useMemo(
    () => eventFiltersFromSearch(eventFilterSearch),
    [eventFilterSearch],
  );
  const {
    season,
    distance,
    typeFilter,
    statusFilters,
    recommendedOnly,
    myEventsOnly,
  } = eventFilters;
  const initialRoute = routeFromPath(pathname, initialData);
  const initialAccount = cachedSessionAccount ?? null;
  const initialCanEdit =
    initialAccount?.role === "admin" || initialAccount?.role === "moderator";
  const initialView =
    initialRoute.view === "gestao" && initialAccount && !initialCanEdit
      ? "mural"
      : initialRoute.view;
  const [screen, setScreen] = useState<Screen>(() =>
    initialRoute.screen === "request"
      ? "request"
      : initialAccount
        ? "app"
        : "login",
  );
  const [view, setView] = useState<View>(() => initialView);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(
    () => initialAccount,
  );
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [data, setData] = useState<AppData>(initialData);
  const [loginUser, setLoginUser] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestConsent, setRequestConsent] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestForm, setRequestForm] = useState<RequestForm>({
    studentName: "",
    dateOfBirth: "",
    fideId: "",
    guardianEmail: "",
    phone: "",
    password: "",
    confirmPassword: "",
    message: "",
  });
  const [selectedEventId, setSelectedEventId] = useState(
    () =>
      initialRoute.eventId ??
      initialData.events.find((event) => event.status === "ongoing")?.id ??
      initialData.events[0]?.id ??
      "",
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState(
    () => initialRoute.playerId ?? initialData.players[0]?.id ?? "",
  );
  const [selectedGameId, setSelectedGameId] = useState(
    () => initialRoute.gameId ?? initialData.games[0]?.id ?? "",
  );
  const [ply, setPly] = useState(0);
  const [fideMonth, setFideMonth] = useState(-1);
  const [fideType, setFideType] = useState<"combined" | EventType>("combined");
  const [fideSort, setFideSort] = useState<"combined" | EventType | "medals">(
    "combined",
  );
  const [fideGroup, setFideGroup] = useState(false);
  const [search, setSearch] = useState("");
  const [trophySeason, setTrophySeason] = useState("Todas");
  const [hoverPost, setHoverPost] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState>({
    title: "",
    body: "",
    tint: TINTS[0],
  });
  const [mdHelpOpen, setMdHelpOpen] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventForm, setEventForm] = useState<EventForm>({
    name: "",
    location: "",
    dateLabel: "",
    startsOn: "",
    endsOn: "",
    url: "",
    regulationUrl: "",
    type: "standard",
    status: "upcoming",
    season: "2025/26",
    month: "JUN",
    deadline: "",
  });
  const [eventImport, setEventImport] = useState<EventImportState>({
    status: "idle",
  });
  const [eventSync, setEventSync] = useState<Record<string, EventSyncState>>(
    {},
  );
  const liveSyncAttemptedAt = useRef<Record<string, number>>({});
  const [manageOpen, setManageOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [award, setAward] = useState<AwardState>(null);
  const [edit, setEdit] = useState<EditState>(null);
  const [passwordModal, setPasswordModal] = useState<{
    name: string;
    value: string;
  } | null>(null);
  const [pgnUpload, setPgnUpload] = useState<PgnUploadState>(null);
  const [pgnUploading, setPgnUploading] = useState(false);
  const [calendarPlayerId, setCalendarPlayerId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [drag, setDrag] = useState<{
    id: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);

  const role = currentAccount?.role ?? "student";
  const canEdit = role === "admin" || role === "moderator";
  const isAdmin = role === "admin";
  const user =
    currentAccount ??
    ({
      id: "anonymous",
      name: "",
      email: "",
      role: "student",
      status: "disabled",
      profileStatus: "incomplete",
      missingFields: [],
    } satisfies Account);
  const userRoleLabel = roleLabel(user.role);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { account?: Account };
      })
      .then((payload) => {
        if (!alive) return;
        if (!payload?.account) {
          if (!cachedSessionAccount && !isAuthPath(pathname))
            setScreen("login");
          return;
        }
        rememberSessionAccount(payload.account);
        if (isAuthPath(pathname)) router.replace("/mural");
        else setScreen("app");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const route = routeFromPath(pathname, data);

    if (route.screen === "request") {
      setScreen("request");
      setEventModalOpen(false);
      return;
    }

    if (route.screen === "login") {
      setScreen(currentAccount ? "app" : "login");
      setView("mural");
      setEventModalOpen(false);
      return;
    }

    if (route.view === "gestao" && currentAccount && !canEdit) {
      router.replace("/mural");
      return;
    }

    setView(route.view);
    if (route.eventId) setSelectedEventId(route.eventId);
    if (route.playerId) setSelectedPlayerId(route.playerId);
    if (route.gameId) setSelectedGameId(route.gameId);
    setManageOpen(Boolean(route.manageOpen));
    setEventModalOpen(Boolean(route.eventModal && canEdit));
    setScreen(currentAccount ? "app" : "login");
  }, [pathname, currentAccount, canEdit]);

  useEffect(() => {
    if (!eventModalOpen) return;
    const url = eventForm.url.trim();
    if (!isChessResultsUrlInput(url)) {
      setEventImport({ status: "idle" });
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setEventImport({ status: "loading" });
      try {
        const response = await fetch("/api/chess-results/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const payload = (await response.json().catch(() => null)) as {
          jobId?: string;
          error?: string;
        } | null;
        if (!response.ok || !payload?.jobId) {
          throw new Error(
            payload?.error ?? "Não foi possível iniciar a importação.",
          );
        }
        if (cancelled) return;
        setEventImport({ status: "loading", jobId: payload.jobId });
        const imported = await pollChessResultsImport(
          payload.jobId,
          () => cancelled,
        );
        if (cancelled) return;
        setEventImport({ status: "ready", data: imported });
        setEventForm((form) => applyImportToEventForm(form, imported));
      } catch (error) {
        if (cancelled) return;
        setEventImport({
          status: "error",
          message:
            error instanceof Error ? error.message : "Importação falhou.",
        });
      }
    }, 550);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [eventModalOpen, eventForm.url]);

  const selectedEvent =
    data.events.find((event) => event.id === selectedEventId) ?? data.events[0];
  const selectedPlayer =
    data.players.find((player) => player.id === selectedPlayerId) ??
    data.players[0];
  const selectedGame =
    data.games.find((game) => game.id === selectedGameId) ?? data.games[0];
  const currentPlayerId = useMemo(
    () => findAccountPlayerId(currentAccount, data.players),
    [currentAccount, data.players],
  );
  const currentAnnotation =
    selectedGame && ply > 0 ? (selectedGame.annotations[ply - 1] ?? "") : "";

  useEffect(() => {
    setAnnotationDraft(currentAnnotation);
  }, [selectedGame?.id, ply, currentAnnotation]);

  const medalMap = useMemo(() => buildMedalMap(data.medals), [data.medals]);
  const fideMonths = useMemo(
    () => ratingMonthOptions(data.players),
    [data.players],
  );
  const selectedFideMonthIndex =
    fideMonth >= 0 && fideMonth < fideMonths.length
      ? fideMonth
      : Math.max(0, fideMonths.length - 1);
  const selectedFideMonth = fideMonths[selectedFideMonthIndex]?.month;

  useEffect(() => {
    if (
      view !== "evento" ||
      !selectedEvent ||
      selectedEvent.status !== "ongoing" ||
      !isChessResultsUrlInput(selectedEvent.chessResultsUrl)
    ) {
      return;
    }

    const now = Date.now();
    const lastAttempt = liveSyncAttemptedAt.current[selectedEvent.id] ?? 0;
    if (now - lastAttempt < 60_000) return;
    liveSyncAttemptedAt.current[selectedEvent.id] = now;

    let cancelled = false;
    void syncEventFromChessResults(selectedEvent, {
      automatic: true,
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [
    view,
    selectedEvent?.id,
    selectedEvent?.status,
    selectedEvent?.chessResultsUrl,
  ]);

  function rememberSessionAccount(account: Account | null) {
    cachedSessionAccount = account;
    setCurrentAccount(account);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function persist<T = { ok?: boolean; error?: string }>(
    path: string,
    payload: unknown,
  ): Promise<T> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: string })
      | null;
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error ?? "Não foi possível guardar a alteração.");
    }
    return (result ?? ({ ok: true } as T)) as T;
  }

  async function syncEventFromChessResults(
    event: EventRecord,
    options: { automatic?: boolean; isCancelled?: () => boolean } = {},
  ) {
    if (!isChessResultsUrlInput(event.chessResultsUrl)) return;
    const automatic = Boolean(options.automatic);
    const isCancelled = options.isCancelled ?? (() => false);
    setEventSync((current) => ({
      ...current,
      [event.id]: {
        status: "syncing",
        automatic,
        message: automatic
          ? "A atualizar evento ao vivo…"
          : "A sincronizar Chess-Results…",
      },
    }));

    try {
      const response = await fetch("/api/events/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: event.id, automatic }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        skipped?: boolean;
        debounced?: boolean;
        jobId?: string;
        status?: string;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.error ?? "Não foi possível iniciar a sincronização.",
        );
      }
      if (isCancelled()) return;
      if (payload.skipped) {
        setEventSync((current) => ({
          ...current,
          [event.id]: {
            status: "debounced",
            automatic,
            message: "Sem sincronização automática.",
          },
        }));
        return;
      }

      if (payload.jobId) {
        setEventSync((current) => ({
          ...current,
          [event.id]: {
            status: payload.debounced ? "debounced" : "syncing",
            automatic,
            jobId: payload.jobId,
            message: payload.debounced
              ? "Pedido recente encontrado; a aguardar resultado…"
              : "Sincronização na fila…",
          },
        }));
        await pollWorkerJob(payload.jobId, isCancelled);
      } else if (payload.debounced) {
        setEventSync((current) => ({
          ...current,
          [event.id]: {
            status: "debounced",
            automatic,
            message:
              payload.message ?? "Sincronização recente; dados já atualizados.",
          },
        }));
      }

      if (isCancelled()) return;
      await refreshAppData();
      if (isCancelled()) return;
      setEventSync((current) => ({
        ...current,
        [event.id]: {
          status: payload.debounced ? "debounced" : "succeeded",
          automatic,
          jobId: payload.jobId,
          message: payload.debounced
            ? (payload.message ?? "Sincronização recente; dados atualizados.")
            : "Chess-Results atualizado.",
        },
      }));
      if (!automatic)
        showToast(
          payload.debounced
            ? "Sincronização recente"
            : "Chess-Results atualizado",
        );
    } catch (error) {
      if (isCancelled()) return;
      const message =
        error instanceof Error ? error.message : "Sincronização falhou.";
      setEventSync((current) => ({
        ...current,
        [event.id]: { status: "failed", automatic, message },
      }));
      if (!automatic) showToast(message);
    }
  }

  async function refreshAppData() {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) throw new Error("Não foi possível atualizar os dados.");
    const nextData = (await response.json()) as AppData;
    setData(nextData);
    return nextData;
  }

  function updateEventFilters(patch: Partial<EventFilterState>) {
    router.replace(eventsRouteForFilters({ ...eventFilters, ...patch }), {
      scroll: false,
    });
  }

  function eventsListRoute() {
    return eventsRouteForFilters(eventFilters);
  }

  function eventDetailRoute(id: string) {
    return appendEventFilterSearch(eventRoute(id, data), eventFilters);
  }

  function eventRegistrationDetailRoute(id: string) {
    return appendEventFilterSearch(eventRegistrationsRoute(id), eventFilters);
  }

  function go(next: View) {
    if (next === "gestao" && !canEdit) return;
    setView(next);
    setManageOpen(false);
    setEventModalOpen(false);
    router.push(
      next === "eventos"
        ? eventsListRoute()
        : pathForView(
            next,
            {
              eventId: selectedEvent?.id,
              playerId: selectedPlayer?.id,
              gameId: selectedGame?.id,
            },
            data,
          ),
    );
  }

  function openEvent(id: string) {
    setSelectedEventId(id);
    setView("evento");
    setManageOpen(false);
    setEventModalOpen(false);
    router.push(eventDetailRoute(id));
  }

  function openPlayer(id: string) {
    setSelectedPlayerId(id);
    setView("jogador");
    setEventModalOpen(false);
    router.push(playerRoute(id, data));
  }

  function openGame(gameId: string, playerId = selectedPlayerId) {
    setSelectedGameId(gameId);
    setSelectedPlayerId(playerId);
    setPly(0);
    setAnnotationDraft("");
    setView("partida");
    router.push(gameRoute(gameId));
  }

  function closeEventModal() {
    setEventModalOpen(false);
    router.push(eventsListRoute());
  }

  function toggleManageRegistrations(event: EventRecord) {
    const nextOpen = !manageOpen;
    setManageOpen(nextOpen);
    router.push(
      nextOpen
        ? eventRegistrationDetailRoute(event.id)
        : eventDetailRoute(event.id),
    );
  }

  async function submitLogin() {
    if (loginBusy) return;
    setLoginError(null);
    setLoginBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: loginUser, password: loginPw }),
      });
      const payload = (await response.json().catch(() => null)) as {
        account?: Account;
        error?: string;
      } | null;
      if (!response.ok || !payload?.account) {
        setLoginError(payload?.error ?? "Não foi possível iniciar sessão.");
        return;
      }
      rememberSessionAccount(payload.account);
      await refreshAppData();
      setLoginPw("");
      setScreen("app");
      if (isAuthPath(pathname)) router.push("/mural");
    } catch {
      setLoginError("Não foi possível contactar o servidor.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    rememberSessionAccount(null);
    setUserMenuOpen(false);
    setView("mural");
    setScreen("login");
    router.push("/login");
  }

  async function submitRequest() {
    if (requestBusy) return;
    const validation = validateRequestForm(requestForm, requestConsent);
    if (!validation.ok) {
      setRequestError(validation.error);
      return;
    }

    setRequestError(null);
    setRequestBusy(true);
    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validation.value),
      });
      const payload = (await response.json().catch(() => null)) as {
        account?: Account;
        error?: string;
      } | null;
      if (!response.ok) {
        setRequestError(payload?.error ?? "Não foi possível enviar o pedido.");
        return;
      }
      if (payload?.account) {
        setData((current) => ({
          ...current,
          accounts: current.accounts.some(
            (account) => account.id === payload.account!.id,
          )
            ? current.accounts
            : [...current.accounts, payload.account!],
        }));
      }
      setRequestSent(true);
      setRequestConsent(false);
    } catch {
      setRequestError("Não foi possível contactar o servidor.");
    } finally {
      setRequestBusy(false);
    }
  }

  async function saveCompose() {
    const post: MuralPost = {
      id: crypto.randomUUID(),
      tag: "Nota",
      author: user.name,
      date: todayIsoDate(),
      tint: compose.tint,
      rotation: ["-1.4deg", "1deg", "-.7deg", "1.5deg"][
        Math.floor(Math.random() * 4)
      ],
      x: 48 + Math.random() * 60,
      y: 42 + Math.random() * 60,
      z: Math.max(1, ...data.posts.map((p) => p.z)) + 1,
      title: compose.title.trim() || "Nova nota",
      body: compose.body.trim() || "(sem texto)",
    };
    try {
      await persist("/api/mural-posts", post);
      setData((current) => ({ ...current, posts: [...current.posts, post] }));
      setComposeOpen(false);
      setCompose({ title: "", body: "", tint: TINTS[0] });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível afixar o post-it.");
    }
  }

  async function removePost(id: string) {
    try {
      await persist("/api/mural-posts/delete", { id });
      setData((current) => ({
        ...current,
        posts: current.posts.filter((post) => post.id !== id),
      }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível remover o post-it.");
    }
  }

  function shareText(title: string, body: string) {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${title}\n${body}.\n Escola de Xadrez do Porto`)}`,
      "_blank",
      "noopener,noreferrer",
    );
    showToast("Link de WhatsApp aberto");
  }

  async function saveEvent() {
    if (
      !eventForm.name.trim() ||
      eventImport.status === "loading" ||
      eventSaving
    )
      return;
    const imported = eventImport.status === "ready" ? eventImport.data : null;
    const deadlines = imported?.deadlines.length
      ? imported.deadlines
      : eventForm.deadline.trim()
        ? [{ label: "Prazo de inscrição", value: eventForm.deadline.trim() }]
        : [];
    const importedRegistrationIds = imported
      ? Array.from(
          new Set(
            [
              ...imported.initialRanking.map(
                (row) => findTournamentPlayer(data.players, row)?.id,
              ),
              ...(imported.teamMembers ?? []).map(
                (member) => findTeamMemberPlayer(member, data.players)?.id,
              ),
            ].filter(Boolean) as string[],
          ),
        )
      : [];
    const event: EventRecord = {
      id: `event-${Date.now()}`,
      season: eventForm.season,
      month: eventForm.month,
      dateLabel: eventForm.dateLabel || "a definir",
      startsOn: eventForm.startsOn || undefined,
      endsOn: eventForm.endsOn || eventForm.startsOn || undefined,
      name: eventForm.name.trim(),
      location: eventForm.location.trim() || "A definir",
      type: eventForm.type,
      format: imported?.format,
      distanceKm: 0,
      participantsLabel: imported?.participantsLabel ?? "Inscrições abertas",
      status: eventForm.status,
      chessResultsUrl:
        imported?.chessResultsUrl ??
        (eventForm.url.trim() || "https://chess-results.com"),
      regulationUrl: eventForm.regulationUrl.trim() || undefined,
      deadlines,
      documents: imported?.documents,
      initialRanking: imported?.initialRanking,
      teamStandings: imported?.teamStandings,
      teamMembers: imported?.teamMembers,
      registrations: importedRegistrationIds,
      registrationDetails: importedRegistrationIds.map((playerId) => ({
        playerId,
        status: "confirmed",
      })),
    };
    const payload = {
      ...event,
      chessResultsTnr: imported?.chessResultsTnr,
      chessResultsImport: imported ?? undefined,
    };
    setEventSaving(true);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Não foi possível criar o evento.");
      }
      const nextData = await refreshAppData();
      const nextFilters = {
        ...eventFilters,
        season: eventForm.season,
        recommendedOnly: false,
        myEventsOnly: false,
      };
      setEventModalOpen(false);
      router.push(
        appendEventFilterSearch(eventRoute(event.id, nextData), nextFilters),
      );
      showToast("Evento criado");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o evento.",
      );
    } finally {
      setEventSaving(false);
    }
  }

  async function toggleRecommended(eventId: string) {
    try {
      await persist("/api/events/recommend", { eventId });
      setData((current) => ({
        ...current,
        events: current.events.map((event) =>
          event.id === eventId
            ? { ...event, recommended: !event.recommended }
            : event,
        ),
      }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível alterar a recomendação.");
    }
  }

  async function toggleRegistration(eventId: string, playerId: string) {
    const currentEvent = data.events.find((event) => event.id === eventId);
    const currentlyRegistered =
      currentEvent?.registrations.includes(playerId) ?? false;
    const inChessResults = currentEvent
      ? buildRegistrationSyncState(
          currentEvent,
          data.players,
        ).chessResultsPlayerIds.has(playerId)
      : false;
    try {
      await persist("/api/events/registrations", {
        eventId,
        playerId,
        action: currentlyRegistered ? "withdraw" : "select",
      });
      setData((current) => ({
        ...current,
        events: current.events.map((event) => {
          if (event.id !== eventId) return event;
          const exists = event.registrations.includes(playerId);
          const registrationDetails = event.registrationDetails ?? [];
          return {
            ...event,
            registrations: exists
              ? event.registrations.filter((id) => id !== playerId)
              : [...event.registrations, playerId],
            registrationDetails: exists
              ? registrationDetails.filter(
                  (registration) => registration.playerId !== playerId,
                )
              : upsertRegistrationDetail(registrationDetails, {
                  playerId,
                  status: inChessResults ? "confirmed" : "selected",
                }),
          };
        }),
      }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível alterar a inscrição.");
    }
  }

  async function saveAward() {
    if (!award || !award.label.trim()) return;
    const medal: Medal = {
      id: crypto.randomUUID(),
      eventId: award.eventId,
      playerId: award.playerId,
      type: award.type,
      source: "manual",
      label: award.label.trim(),
    };
    try {
      await persist("/api/medals", medal);
      setData((current) => ({ ...current, medals: [...current.medals, medal] }));
      setAward(null);
      showToast("Medalha atribuída");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível atribuir a medalha.");
    }
  }

  async function removeMedal(id: string) {
    try {
      await persist("/api/medals/delete", { id });
      setData((current) => ({
        ...current,
        medals: current.medals.filter((medal) => medal.id !== id),
      }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível remover a medalha.");
    }
  }

  function openEdit(account: Account) {
    if (!canEdit) return;
    setEdit({
      accountId: account.id,
      name: account.name,
      email: account.email,
      fideId: account.fideId ?? "",
      dateOfBirth: account.dateOfBirth ?? "",
      phone: account.phone ?? "",
      temporaryPassword: "",
    });
  }

  async function saveEdit() {
    if (!edit) return;
    const missingFields = computeMissingFields(edit);
    const temp = edit.temporaryPassword.trim();
    try {
      await persist("/api/accounts/update", edit);
      if (temp) {
        await persist("/api/accounts/manual-password", {
          accountId: edit.accountId,
          value: temp,
        });
      }
      setData((current) => ({
        ...current,
        accounts: current.accounts.map((account) =>
          account.id === edit.accountId
            ? {
                ...account,
                name: edit.name,
                email: edit.email,
                fideId: edit.fideId || undefined,
                dateOfBirth: edit.dateOfBirth || undefined,
                phone: edit.phone || undefined,
                profileStatus: missingFields.length ? "incomplete" : "complete",
                missingFields,
              }
            : account,
        ),
      }));
      setEdit(null);
      showToast(
        temp
          ? "Conta atualizada · palavra-passe temporária definida"
          : "Dados da conta atualizados",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível atualizar a conta.");
    }
  }

  async function setAccountPatch(id: string, patch: Partial<Account>) {
    try {
      await persist("/api/accounts/update", { id, patch });
      await refreshAppData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível atualizar a conta.");
    }
  }

  async function resetPassword(account: Account) {
    const value = generatePassword();
    try {
      await persist("/api/accounts/manual-password", {
        accountId: account.id,
        value,
      });
      setPasswordModal({ name: account.name, value });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível definir a palavra-passe.");
    }
  }

  function openPgnUpload(player: Player) {
    setPgnUpload({
      playerId: player.id,
      eventName: "",
      playedOn: "",
      white: player.name,
      black: "",
      result: "*",
      eco: "",
    });
  }

  async function submitPgnUpload() {
    if (!pgnUpload || pgnUploading) return;
    if (!pgnUpload.file) {
      showToast("Escolhe um ficheiro PGN.");
      return;
    }

    const form = new FormData();
    form.set("playerId", pgnUpload.playerId);
    form.set("eventName", pgnUpload.eventName);
    form.set("playedOn", pgnUpload.playedOn);
    form.set("white", pgnUpload.white);
    form.set("black", pgnUpload.black);
    form.set("result", pgnUpload.result);
    form.set("eco", pgnUpload.eco);
    form.set("file", pgnUpload.file);

    setPgnUploading(true);
    try {
      const response = await fetch("/api/games/upload", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as {
        imported?: number;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Upload PGN falhou.");
      }
      await refreshAppData();
      setPgnUpload(null);
      showToast(
        `${payload?.imported ?? 0} partida(s) PGN carregada(s) com sucesso`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Upload PGN falhou.");
    } finally {
      setPgnUploading(false);
    }
  }

  async function saveAnnotation() {
    if (!selectedGame || ply < 1) return;
    const text = annotationDraft;
    try {
      await persist("/api/games/annotations", {
        gameId: selectedGame.id,
        ply,
        body: text,
      });
      setData((current) => ({
        ...current,
        games: current.games.map((game) => {
          if (game.id !== selectedGame.id) return game;
          const annotations = { ...game.annotations };
          if (text.trim()) annotations[ply - 1] = text;
          else delete annotations[ply - 1];
          return { ...game, annotations };
        }),
      }));
      showToast(text.trim() ? "Anotação guardada" : "Anotação removida");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível guardar a anotação.");
    }
  }

  function renderLogin() {
    return (
      <div className="login-page">
        <div className="login-art">
          <div className="brand" style={{ position: "relative", zIndex: 1 }}>
            <BrandMark white />
            <div>
              <div className="disp" style={{ fontSize: 18, fontWeight: 800 }}>
                Escola de Xadrez do Porto
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: ".2em",
                  opacity: 0.82,
                  marginTop: 2,
                }}
              >
                EFANOR · DESDE 2012
              </div>
            </div>
          </div>
          <div style={{ position: "relative", zIndex: 1, maxWidth: 460 }}>
            <h1 className="disp login-title">
              Toda a grande partida começa com a abertura certa.
            </h1>
            <p
              className="pretty"
              style={{
                fontSize: 15,
                lineHeight: 1.55,
                opacity: 0.92,
                marginTop: 18,
                maxWidth: 392,
              }}
            >
              A tua área de clube: mural, calendário de provas, ratings FIDE e
              análise de partidas num tabuleiro só.
            </p>
          </div>
          <div
            className="mono"
            style={{
              position: "relative",
              zIndex: 1,
              fontSize: 11,
              letterSpacing: ".14em",
              opacity: 0.72,
            }}
          >
            {data.players.length} ATLETAS · {data.medals.length} PÓDIOS ESTA
            ÉPOCA
          </div>
        </div>
        <div className="login-card-wrap">
          <div className="login-card">
            <h2
              className="disp"
              style={{ fontSize: 31, fontWeight: 800, margin: 0 }}
            >
              Entrar
            </h2>
            <p
              style={{
                color: "var(--muted)",
                fontSize: 14,
                margin: "8px 0 28px",
              }}
            >
              Bem-vindo de volta ao clube.
            </p>
            <label className="label">Utilizador</label>
            <input
              className="input"
              value={loginUser}
              onChange={(event) => setLoginUser(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitLogin();
              }}
              placeholder="o teu email"
              style={{ marginBottom: 16 }}
            />
            <label className="label">Palavra-passe</label>
            <input
              className="input"
              value={loginPw}
              onChange={(event) => setLoginPw(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitLogin();
              }}
              type="password"
              placeholder="••••••••"
              style={{ marginBottom: loginError ? 10 : 20 }}
            />
            {loginError && (
              <div
                role="alert"
                style={{
                  color: "var(--red)",
                  fontSize: 12.5,
                  marginBottom: 14,
                }}
              >
                {loginError}
              </div>
            )}
            <button
              className="btn btn-primary"
              style={{ width: "100%", padding: 14 }}
              onClick={() => void submitLogin()}
              disabled={loginBusy}
            >
              {loginBusy ? "A entrar…" : "Entrar no clube"}
            </button>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                margin: "22px 0",
              }}
            >
              <div style={{ flex: 1, height: 1, background: "#ece6e0" }} />
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: ".16em",
                  color: "#b4aba2",
                }}
              >
                OU
              </span>
              <div style={{ flex: 1, height: 1, background: "#ece6e0" }} />
            </div>
            <div
              style={{
                textAlign: "center",
                fontSize: 14,
                color: "var(--muted)",
              }}
            >
              Ainda não jogas connosco?{" "}
              <button
                type="button"
                onClick={() => {
                  setScreen("request");
                  setRequestSent(false);
                  setRequestError(null);
                  router.push("/pedir-acesso");
                }}
                style={{
                  border: 0,
                  background: "none",
                  color: "var(--pink)",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Pedir acesso ›
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderRequest() {
    return (
      <div className="request-page">
        <div className="request-card">
          <button
            className="btn btn-ghost btn-small"
            style={{ marginBottom: 22 }}
            onClick={() => {
              setScreen("login");
              router.push("/login");
            }}
          >
            ‹ Voltar ao início
          </button>
          {requestSent ? (
            <div style={{ textAlign: "center", padding: "18px 0" }}>
              <div
                className="gradient"
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 30,
                  margin: "0 auto 18px",
                }}
              >
                ♛
              </div>
              <h2
                className="disp"
                style={{ fontSize: 26, fontWeight: 800, margin: 0 }}
              >
                Pedido enviado!
              </h2>
              <p
                className="pretty"
                style={{
                  color: "var(--muted)",
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  margin: "12px auto 24px",
                  maxWidth: 380,
                }}
              >
                Os treinadores vão rever o teu pedido e ativar a conta. Recebes
                indicação assim que estiver pronta.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setScreen("login");
                  router.push("/login");
                }}
              >
                Voltar ao início
              </button>
            </div>
          ) : (
            <>
              <h2
                className="disp"
                style={{ fontSize: 27, fontWeight: 800, margin: 0 }}
              >
                Pedir acesso
              </h2>
              <p
                className="pretty"
                style={{
                  color: "var(--muted)",
                  fontSize: 14,
                  margin: "8px 0 26px",
                  lineHeight: 1.5,
                }}
              >
                As contas são ativadas pelos treinadores. Preenche os dados,
                escolhe a tua palavra-passe e podes entrar assim que a conta for
                ativada.
              </p>
              <div className="form-grid">
                <Field label="Nome do aluno" span>
                  <input
                    className="input"
                    value={requestForm.studentName}
                    onChange={(event) =>
                      setRequestForm((form) => ({
                        ...form,
                        studentName: event.target.value,
                      }))
                    }
                    placeholder="Nome completo"
                  />
                </Field>
                <Field label="Data de nascimento">
                  <BirthDateInput
                    value={requestForm.dateOfBirth}
                    error={requestError?.includes("nascimento")}
                    onChange={(dateOfBirth) =>
                      setRequestForm((form) => ({
                        ...form,
                        dateOfBirth,
                      }))
                    }
                  />
                </Field>
                <Field label="ID FIDE (se tiver)">
                  <input
                    className="input"
                    value={requestForm.fideId}
                    onChange={(event) =>
                      setRequestForm((form) => ({
                        ...form,
                        fideId: event.target.value,
                      }))
                    }
                    placeholder="opcional"
                  />
                </Field>
                <Field label="Email do encarregado">
                  <input
                    className="input"
                    value={requestForm.guardianEmail}
                    onChange={(event) =>
                      setRequestForm((form) => ({
                        ...form,
                        guardianEmail: event.target.value,
                      }))
                    }
                    placeholder="email@exemplo.pt"
                  />
                </Field>
                <Field label="Telefone">
                  <input
                    className="input"
                    value={requestForm.phone}
                    onChange={(event) =>
                      setRequestForm((form) => ({
                        ...form,
                        phone: event.target.value,
                      }))
                    }
                    placeholder="9XX XXX XXX"
                  />
                </Field>
                <Field label="Palavra-passe">
                  <input
                    className="input"
                    value={requestForm.password}
                    onChange={(event) =>
                      setRequestForm((form) => ({
                        ...form,
                        password: event.target.value,
                      }))
                    }
                    type="password"
                    placeholder="mínimo 8 caracteres"
                  />
                </Field>
                <Field label="Confirmar palavra-passe">
                  <input
                    className="input"
                    value={requestForm.confirmPassword}
                    onChange={(event) =>
                      setRequestForm((form) => ({
                        ...form,
                        confirmPassword: event.target.value,
                      }))
                    }
                    type="password"
                    placeholder="repete a palavra-passe"
                  />
                </Field>
                <Field label="Mensagem" span>
                  <textarea
                    className="textarea"
                    value={requestForm.message}
                    onChange={(event) =>
                      setRequestForm((form) => ({
                        ...form,
                        message: event.target.value,
                      }))
                    }
                    placeholder="Conta-nos a experiência de xadrez do aluno…"
                  />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => setRequestConsent((value) => !value)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 11,
                  marginTop: 20,
                  padding: "14px 15px",
                  borderRadius: 12,
                  cursor: "pointer",
                  border: `1px solid ${requestConsent ? "#f3cce0" : "#e4dcd4"}`,
                  background: requestConsent ? "#fbe7f2" : "#fbf9f7",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: requestConsent ? "var(--pink)" : "transparent",
                    border: `2px solid ${requestConsent ? "var(--pink)" : "#cfc5bb"}`,
                    color: "#fff",
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {requestConsent ? "✓" : ""}
                </span>
                <span
                  style={{ fontSize: 13, lineHeight: 1.5, color: "#52483f" }}
                >
                  Autorizo a <b>Escola de Xadrez do Porto</b> a contactar-me
                  através dos dados fornecidos para assuntos do clube (incluindo
                  a adição ao <b>grupo de WhatsApp</b> de avisos e
                  convocatórias).
                </span>
              </button>
              {requestError && (
                <div
                  role="alert"
                  style={{ color: "var(--red)", fontSize: 12.5, marginTop: 12 }}
                >
                  {requestError}
                </div>
              )}
              <button
                className={`btn ${requestConsent ? "btn-primary" : "btn-ghost"}`}
                style={{
                  width: "100%",
                  marginTop: 16,
                  cursor:
                    requestConsent && !requestBusy ? "pointer" : "not-allowed",
                }}
                onClick={() => void submitRequest()}
                disabled={requestBusy || !requestConsent}
              >
                {requestBusy
                  ? "A enviar…"
                  : requestConsent
                    ? "Enviar pedido"
                    : "Confirma a autorização para continuar"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderShell() {
    const [title, subtitle] = VIEW_META[view];
    return (
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <BrandMark />
            <div>
              <div className="disp brand-title">Escola de Xadrez</div>
              <div className="mono brand-sub">DO PORTO · EFANOR</div>
            </div>
          </div>
          <nav className="nav" aria-label="Secções">
            {NAV.filter(([key]) => key !== "gestao" || canEdit).map(
              ([key, label, glyph]) => {
                const active = activeNav(view) === key;
                return (
                  <button
                    key={key}
                    aria-label={label}
                    className={`nav-item ${active ? "active" : ""}`}
                    onClick={() => go(key as View)}
                  >
                    <span className="nav-glyph">{glyph}</span>
                    <span>{label}</span>
                  </button>
                );
              },
            )}
          </nav>
          <div className="mono sidebar-foot">DESDE 2012</div>
        </aside>
        <div className="app-column">
          <header className="app-header">
            <div>
              <h1 className="disp">{title}</h1>
              <div className="app-subtitle">{subtitle}</div>
            </div>
            <div style={{ position: "relative" }}>
              <button
                className="user-button"
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <span className="avatar">{initials(user.name)}</span>
                <span
                  className="user-copy"
                  style={{ textAlign: "left", lineHeight: 1.15 }}
                >
                  <span
                    style={{
                      display: "block",
                      fontWeight: 800,
                      fontSize: 13.5,
                    }}
                  >
                    {user.name}
                  </span>
                  <span
                    style={{
                      display: "block",
                      color: "var(--soft)",
                      fontSize: 11,
                    }}
                  >
                    {userRoleLabel}
                  </span>
                </span>
                <span style={{ color: "#c9c0b6", fontSize: 11 }}>▾</span>
              </button>
              {userMenuOpen && <UserMenu />}
            </div>
          </header>
          <main className="main">
            <div className="main-inner">{renderView()}</div>
          </main>
        </div>
        {renderModals()}
        {toast && (
          <div className="toast">
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "#25d366",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
              }}
            >
              ✓
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{toast}</span>
          </div>
        )}
      </div>
    );
  }

  function UserMenu() {
    return (
      <>
        <div className="menu-backdrop" onClick={() => setUserMenuOpen(false)} />
        <div className="user-menu">
          <div
            style={{
              padding: "15px 16px",
              borderBottom: "1px solid #f1ebe4",
              display: "flex",
              alignItems: "center",
              gap: 11,
            }}
          >
            <span className="avatar">{initials(user.name)}</span>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{user.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--soft)" }}>
                {user.email} · {userRoleLabel}
              </div>
            </div>
          </div>
          <button
            onClick={() => void logout()}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              background: "none",
              border: 0,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ⎋ Terminar sessão
          </button>
        </div>
      </>
    );
  }

  function renderView() {
    if (view === "mural") return renderMural();
    if (view === "eventos") return renderEvents();
    if (view === "evento") return renderEventDetail();
    if (view === "fide") return renderFide();
    if (view === "jogador") return renderPlayer();
    if (view === "partida") return renderGame();
    if (view === "trofeus") return renderTrophies();
    return renderManagement();
  }

  function renderMural() {
    const pinColors = [
      "#E0463C",
      "#2F77C9",
      "#3E9B52",
      "#E8A93B",
      "#7A52C9",
      "#D8439A",
    ];
    return (
      <div className="container">
        <div className="section-head">
          <h2 className="disp section-title">
            Recados, avisos
            <br />e vitórias.
          </h2>
          {canEdit && (
            <button
              className="btn btn-primary"
              onClick={() => setComposeOpen(true)}
            >
              <span style={{ fontSize: 18 }}>+</span> Novo post-it
            </button>
          )}
        </div>
        <div className="mural-board-frame">
          <div
            className="mural-board"
            onPointerMove={(event) => {
              if (!drag) return;
              const nx = Math.max(-10, drag.ox + event.clientX - drag.sx);
              const ny = Math.max(-14, drag.oy + event.clientY - drag.sy);
              setData((current) => ({
                ...current,
                posts: current.posts.map((post) =>
                  post.id === drag.id ? { ...post, x: nx, y: ny } : post,
                ),
              }));
            }}
            onPointerUp={() => setDrag(null)}
          >
            {data.posts.map((post, index) => (
              <article
                key={post.id}
                className="post-it"
                style={{
                  left: post.x,
                  top: post.y,
                  zIndex: post.z,
                  transform: `rotate(${post.rotation})`,
                  background: `linear-gradient(145deg, rgba(255,255,255,.5), rgba(255,255,255,.12) 30%, rgba(255,255,255,0) 55%), ${post.tint}`,
                }}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest("[data-no-drag]"))
                    return;
                  setDrag({
                    id: post.id,
                    sx: event.clientX,
                    sy: event.clientY,
                    ox: post.x,
                    oy: post.y,
                  });
                }}
                onMouseEnter={() => setHoverPost(post.id)}
                onMouseLeave={() => setHoverPost(null)}
              >
                <div
                  className="pin"
                  style={
                    {
                      "--pin": pinColors[index % pinColors.length],
                    } as React.CSSProperties
                  }
                />
                {hoverPost === post.id && (
                  <button
                    data-no-drag
                    className="whatsapp-share"
                    onClick={() => shareText(`📌 ${post.title}`, post.body)}
                    aria-label="Partilhar no WhatsApp"
                  >
                    ↗
                  </button>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 9,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: ".06em",
                      color: "rgba(34,30,27,.5)",
                    }}
                  >
                    {post.tag}
                  </span>
                  {canEdit && (
                    <button
                      data-no-drag
                      onClick={() => removePost(post.id)}
                      style={{
                        border: 0,
                        background: "none",
                        cursor: "pointer",
                        color: "rgba(34,30,27,.38)",
                        fontSize: 18,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {post.imageUrl && (
                  <div
                    style={{
                      width: "100%",
                      height: 118,
                      borderRadius: 2,
                      marginBottom: 11,
                      background: `#fff url(${post.imageUrl}) center/cover no-repeat`,
                      boxShadow: "0 2px 5px rgba(40,24,10,.25)",
                      border: "4px solid #fff",
                    }}
                  />
                )}
                <h3
                  className="disp"
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    margin: "0 0 8px",
                    lineHeight: 1.15,
                  }}
                >
                  {post.title}
                </h3>
                <MarkdownText text={post.body} />
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginTop: 13,
                    paddingTop: 10,
                    borderTop: "1px dashed rgba(34,30,27,.18)",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800 }}>
                    {post.author}
                  </span>
                  <span style={{ fontSize: 11, color: "rgba(34,30,27,.5)" }}>
                    · {relativeDateLabel(post.date)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function importedField(key: string) {
    if (eventImport.status !== "ready") return undefined;
    return (eventImport.data.fieldStatus ??
      fallbackImportFieldStatus(eventImport.data))[key];
  }

  function renderEventImportBlock() {
    if (!eventForm.url.trim()) return null;
    if (!isChessResultsUrlInput(eventForm.url)) {
      return (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
          Cola um link Chess-Results para preencher automaticamente a prova.
        </div>
      );
    }
    if (eventImport.status === "loading") return <EventImportSkeleton />;
    if (eventImport.status === "error") {
      return (
        <div className="event-import-note error">♟ {eventImport.message}</div>
      );
    }
    if (eventImport.status === "ready") {
      return (
        <div className="event-import-note success compact">
          Chess-Results importado. Campos verdes foram preenchidos; amarelos
          precisam de confirmação.
          <ImportInfoIcon
            field={{
              label: "Importação Chess-Results",
              status: "found",
              note: "Passa o rato sobre o ícone ⓘ em cada campo para ver se foi obtido, inferido, assumido por defeito ou não encontrado.",
            }}
          />
        </div>
      );
    }
    return (
      <div className="event-import-note success compact">
        Link Chess-Results detetado.
      </div>
    );
  }

  function renderEvents() {
    const myEventCount = currentPlayerId
      ? data.events.filter((event) =>
          event.registrations.includes(currentPlayerId),
        ).length
      : 0;
    let events = myEventsOnly
      ? data.events.filter(
          (event) =>
            currentPlayerId && event.registrations.includes(currentPlayerId),
        )
      : recommendedOnly
        ? data.events.filter((event) => event.recommended)
        : data.events.filter((event) => event.season === season);
    if (typeFilter !== "all")
      events = events.filter((event) => event.type === typeFilter);
    if (!statusFilters.includes("all"))
      events = events.filter((event) =>
        statusFilters.some((status) =>
          status === "upcoming"
            ? event.status === "upcoming" ||
              event.status === "registration_open"
            : event.status === status,
        ),
      );
    const maxDistance = Number(distance);
    if (maxDistance < 9999)
      events = events.filter(
        (event) => event.distanceKm > 0 && event.distanceKm <= maxDistance,
      );
    events = events
      .slice()
      .sort((a, b) => eventSortValue(b) - eventSortValue(a));
    return (
      <div className="container mid">
        <div className="section-head">
          <h2 className="disp section-title">
            Provas e<br />
            calendário.
          </h2>
          {canEdit && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setEventForm({
                  name: "",
                  location: "",
                  dateLabel: "",
                  startsOn: "",
                  endsOn: "",
                  url: "",
                  regulationUrl: "",
                  type: "standard",
                  status: "upcoming",
                  season,
                  month: "JUN",
                  deadline: "",
                });
                setEventImport({ status: "idle" });
                setEventModalOpen(true);
                router.push(
                  appendEventFilterSearch("/eventos/novo", eventFilters),
                );
              }}
            >
              <span style={{ fontSize: 18 }}>+</span> Novo evento
            </button>
          )}
        </div>
        <div className="filters">
          <FilterSelect
            label="ÉPOCA"
            value={season}
            onChange={(value) =>
              updateEventFilters({
                season: value,
                recommendedOnly: false,
                myEventsOnly: false,
              })
            }
            options={SEASONS.map((s) => [s, s])}
          />
          <FilterSelect
            label="DISTÂNCIA"
            value={distance}
            onChange={(value) => updateEventFilters({ distance: value })}
            options={[
              ["25", "≤ 25 km"],
              ["75", "≤ 75 km"],
              ["250", "≤ 250 km"],
              ["9999", "Qualquer distância"],
            ]}
          />
          <div style={{ flex: 1 }} />
          <button
            className={`chip pink ${recommendedOnly ? "active" : ""}`}
            onClick={() =>
              updateEventFilters({
                recommendedOnly: !recommendedOnly,
                myEventsOnly: false,
              })
            }
          >
            ★ Recomendados{" "}
            <span className="mono" style={{ marginLeft: 4 }}>
              {data.events.filter((event) => event.recommended).length}
            </span>
          </button>
          <button
            className={`chip ${myEventsOnly ? "active" : ""}`}
            onClick={() =>
              updateEventFilters({
                myEventsOnly: !myEventsOnly,
                recommendedOnly: false,
              })
            }
          >
            Meus Eventos{" "}
            <span className="mono" style={{ marginLeft: 4 }}>
              {myEventCount}
            </span>
          </button>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div className="chips">
            {(["all", "standard", "blitz", "rapid"] as const).map((type) => (
              <button
                key={type}
                className={`chip ${typeFilter === type && !recommendedOnly && !myEventsOnly ? "active" : ""}`}
                onClick={() =>
                  updateEventFilters({
                    typeFilter: type,
                    recommendedOnly: false,
                    myEventsOnly: false,
                  })
                }
              >
                {type === "all" ? "Todos" : TYPE_LABEL[type]}
              </button>
            ))}
          </div>
          <div className="chips">
            {(["all", "upcoming", "ongoing", "completed"] as const).map(
              (status) => (
                <button
                  key={status}
                  className={`chip ${statusFilters.includes(status) ? "active" : ""}`}
                  onClick={() =>
                    updateEventFilters({
                      statusFilters: toggleStatusFilter(statusFilters, status),
                    })
                  }
                >
                  {status === "all"
                    ? "Todos"
                    : status === "upcoming"
                      ? "Próximos"
                      : status === "ongoing"
                        ? "A decorrer"
                        : "Concluídos"}
                </button>
              ),
            )}
          </div>
        </div>
        {events.length === 0 ? (
          <EmptyState
            title={
              myEventsOnly
                ? "Ainda não há eventos marcados para ti"
                : recommendedOnly
                  ? "Ainda não há recomendações para ti"
                  : "Sem provas com estes filtros"
            }
            body={
              myEventsOnly
                ? "Quando um admin ou moderador te adicionar em Gerir inscrições, a prova aparece aqui."
                : recommendedOnly
                  ? "Os teus treinadores ainda não recomendaram nenhuma prova."
                  : "Experimenta alargar a distância ou mudar de época."
            }
          />
        ) : (
          <div className="event-list">
            {events.map((event) => (
              <button
                key={event.id}
                className="event-row"
                onClick={() => openEvent(event.id)}
              >
                <div className="event-date">
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: ".15em",
                      color: "#a89e94",
                    }}
                  >
                    {event.month}
                  </div>
                  <div
                    className="disp"
                    style={{ fontSize: 15, fontWeight: 800 }}
                  >
                    {event.dateLabel}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      marginBottom: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    <TypeBadge type={event.type} />
                    <StatusBadge event={event} />
                    {event.recommended && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: "var(--pink)",
                        }}
                      >
                        ★ Recomendado
                      </span>
                    )}
                  </div>
                  <div
                    className="disp"
                    style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.15 }}
                  >
                    {event.name}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--muted)",
                      marginTop: 3,
                    }}
                  >
                    {event.location} · {kmLabel(event.distanceKm)} ·{" "}
                    {event.participantsLabel}
                  </div>
                </div>
                <div style={{ fontSize: 22, color: "#d5ccc2" }}>›</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderEventDetail() {
    if (!selectedEvent) return null;
    const registrationSync = buildRegistrationSyncState(
      selectedEvent,
      data.players,
    );
    const registeredPlayers = registrationSync.registeredPlayers;
    const clubRegisteredCount =
      registeredPlayers.length || registrationSync.importedClubCount;
    const isDone = selectedEvent.status === "completed";
    const isOngoing = selectedEvent.status === "ongoing";
    const isUpcoming = !isDone && !isOngoing;
    const isTeamEvent = isTeamEventRecord(selectedEvent);
    const teamCount = isTeamEvent ? teamCountForEvent(selectedEvent) : 0;
    const syncState = eventSync[selectedEvent.id];
    const canSyncChessResults = isChessResultsUrlInput(
      selectedEvent.chessResultsUrl,
    );
    const isSyncingChessResults = isEventSyncInFlight(syncState);
    const eventMedals = isDone
      ? data.medals.filter((medal) => medal.eventId === selectedEvent.id)
      : [];
    const participantValue = isTeamEvent
      ? teamCount || selectedEvent.participantsLabel
      : clubRegisteredCount;
    const finalRows = buildFinalRows(selectedEvent, data.players);
    return (
      <div className="container narrow">
        <button
          className="btn btn-ghost btn-small"
          style={{ marginBottom: 18 }}
          onClick={() => go("eventos")}
        >
          ‹ Voltar aos eventos
        </button>
        <div
          className="banner event-detail-banner"
          style={{ marginBottom: 18 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              className="badge"
              style={{ background: "rgba(255,255,255,.22)", color: "#fff" }}
            >
              {TYPE_LABEL[selectedEvent.type]}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 12,
                letterSpacing: ".08em",
                color: "rgba(255,255,255,.85)",
              }}
            >
              {selectedEvent.dateLabel} · {selectedEvent.location}
            </span>
            {selectedEvent.provisional && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  background: "rgba(0,0,0,.14)",
                  padding: "3px 9px",
                  borderRadius: 6,
                }}
              >
                calendário provisório
              </span>
            )}
          </div>
          <h2
            className="disp"
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 800,
              lineHeight: 1.08,
              maxWidth: 680,
            }}
          >
            {selectedEvent.name}
          </h2>
          {canSyncChessResults && (
            <button
              className="btn event-sync-button"
              onClick={() => syncEventFromChessResults(selectedEvent)}
              disabled={isSyncingChessResults}
              aria-label={
                isSyncingChessResults
                  ? "A sincronizar Chess-Results"
                  : "Sincronizar Chess-Results"
              }
              title={
                isSyncingChessResults
                  ? "A sincronizar Chess-Results"
                  : "Sincronizar Chess-Results"
              }
            >
              {isSyncingChessResults ? (
                <span className="event-sync-spinner" aria-hidden="true" />
              ) : (
                <span className="event-sync-icon" aria-hidden="true">
                  ↻
                </span>
              )}
            </button>
          )}
        </div>
        {selectedEvent.recommended && role === "student" && (
          <div
            className="panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#fbe7f2",
              borderColor: "#f3cce0",
              color: "#8a2e66",
              marginBottom: 18,
            }}
          >
            <span style={{ color: "var(--pink)", fontSize: 18 }}>★</span>
            <span style={{ fontWeight: 700 }}>
              Recomendado pelos teus treinadores
            </span>
          </div>
        )}
        <div className="info-grid">
          <InfoCard
            label="LOCAL"
            value={selectedEvent.location}
            note={distanceNote(selectedEvent.distanceKm)}
          />
          <InfoCard
            label="PRAZO FINAL"
            value={selectedEvent.deadlines.at(-1)?.value ?? " | "}
            note={
              isDone
                ? "prova concluída"
                : isOngoing
                  ? "prova a decorrer"
                  : "inscrições abertas"
            }
          />
          <InfoCard
            label={isTeamEvent ? "EQUIPAS" : "INSCRITOS"}
            value={
              <span className="event-registration-value">
                <span>{participantValue}</span>
                {eventMedals.length > 0 && (
                  <EventMedalSummary medals={eventMedals} />
                )}
              </span>
            }
            note={
              isTeamEvent
                ? selectedEvent.teamMembers?.length
                  ? `${selectedEvent.teamMembers.length} jogadores nas equipas`
                  : "classificação por equipas"
                : registrationSync.confirmedCount
                  ? `${registrationSync.confirmedCount} confirmados no Chess-Results`
                  : registeredPlayers.length
                    ? "selecionados pelo clube"
                    : "atletas do clube no Chess-Results"
            }
            pink
          />
          <InfoCard
            label="ESTADO"
            value={STATUS_LABEL[selectedEvent.status]}
            note=""
            status
          />
        </div>
        {canEdit && (
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 18,
              flexWrap: "wrap",
            }}
          >
            <button
              className="btn btn-ink"
              onClick={() => toggleManageRegistrations(selectedEvent)}
            >
              Gerir inscrições
            </button>
            <button
              className={`btn ${selectedEvent.recommended ? "btn-primary" : "btn-soft"}`}
              onClick={() => toggleRecommended(selectedEvent.id)}
            >
              ★{" "}
              {selectedEvent.recommended
                ? "Recomendado a alunos ✓"
                : "Recomendar a alunos"}
            </button>
          </div>
        )}
        {manageOpen && renderManagePanel(selectedEvent, registrationSync)}
        <div className="two-col">
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {isDone &&
              (isTeamEvent
                ? renderTeamEvent(selectedEvent, "completed")
                : renderCompletedEvent(selectedEvent, finalRows))}
            {isOngoing &&
              (isTeamEvent
                ? renderTeamEvent(selectedEvent, "ongoing")
                : renderOngoingEvent(selectedEvent))}
            {isUpcoming && renderClubRules()}
            {!isDone &&
              !isTeamEvent &&
              renderRegisteredPlayers(registrationSync)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {selectedEvent.deadlines.length > 0 && (
              <div className="panel">
                <h3
                  className="disp"
                  style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 800 }}
                >
                  Prazos de inscrição
                </h3>
                {selectedEvent.deadlines.map((deadline) => (
                  <div
                    key={deadline.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingBottom: 10,
                      marginBottom: 10,
                      borderBottom: "1px solid #f1ebe4",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      {deadline.label}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 14, fontWeight: 700 }}
                    >
                      {deadline.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!isDone && selectedEvent.initialRanking?.length
              ? renderInitialRankingPanel(selectedEvent)
              : null}
            <div className="panel">
              <h3
                className="disp"
                style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 800 }}
              >
                Documentos
              </h3>
              <DocLink
                label="Chess-Results"
                url={selectedEvent.chessResultsUrl}
              />
              {selectedEvent.regulationUrl && (
                <DocLink
                  label="Regulamento"
                  url={selectedEvent.regulationUrl}
                />
              )}
              {selectedEvent.documents
                ?.filter(
                  (document) => document.url !== selectedEvent.regulationUrl,
                )
                .slice(0, 3)
                .map((document) => (
                  <DocLink
                    key={document.url}
                    label={`${document.label}`}
                    url={document.url}
                  />
                ))}
            </div>
            <div className="panel">
              <h3
                className="disp"
                style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 800 }}
              >
                Partilhar
              </h3>
              <button
                className="btn btn-soft"
                style={{ width: "100%" }}
                onClick={() =>
                  shareText(
                    `${selectedEvent.name}`,
                    `${selectedEvent.dateLabel} · ${selectedEvent.location}\n${selectedEvent.chessResultsUrl}`,
                  )
                }
              >
                Partilhar no WhatsApp
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderManagePanel(
    event: EventRecord,
    sync: EventRegistrationSyncState,
  ) {
    return (
      <div className="card" style={{ marginBottom: 18, overflow: "hidden" }}>
        <div
          style={{
            background: "var(--ink)",
            color: "#fff",
            padding: "16px 22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="disp" style={{ fontWeight: 800, fontSize: 16 }}>
              Gerir inscrições
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,.7)",
                marginTop: 2,
              }}
            >
              As inscrições são feitas PELO CLUBE
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <span className="mono" style={{ fontSize: 13 }}>
              {event.registrations.length} selecionados · {sync.confirmedCount}{" "}
              CR
            </span>
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                setManageOpen(false);
                router.push(eventDetailRoute(event.id));
              }}
            >
              Fechar
            </button>
          </div>
        </div>
        <div
          style={{
            background: "#fcefd8",
            color: "#8a6a1e",
            padding: "10px 22px",
            fontSize: 12.5,
          }}
        >
          ! Inscrição sempre feita pelo clube. Prazo final:{" "}
          <b>{event.deadlines.at(-1)?.value ?? " | "}</b>.
        </div>
        {sync.hasChessResultsStartList && (
          <div
            style={{
              background: "#f1faf5",
              color: "#2f7a4c",
              padding: "10px 22px",
              fontSize: 12.5,
              borderBottom: "1px solid #d4eadc",
            }}
          >
            ♜ Chess-Results: {sync.confirmedCount} confirmados
            {sync.missingFromChessResults.length
              ? ` · ${sync.missingFromChessResults.length} selecionados ainda ausentes`
              : ""}
            {sync.unassociatedClubEntries.length
              ? ` · ${sync.unassociatedClubEntries.length} entradas Efanor por associar`
              : ""}
          </div>
        )}
        {(sync.importedUnregisteredMatches.length > 0 ||
          sync.unassociatedClubEntries.length > 0) && (
          <div
            style={{
              padding: "12px 22px",
              borderBottom: "1px solid #f4eee7",
              background: "#fffdf6",
            }}
          >
            {sync.importedUnregisteredMatches.length > 0 && (
              <div
                style={{
                  marginBottom: sync.unassociatedClubEntries.length ? 10 : 0,
                }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    color: "#8a6a1e",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  NO CHESS-RESULTS, MAS NÃO SELECIONADO LOCALMENTE
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {sync.importedUnregisteredMatches.map(({ row, player }) => (
                    <div
                      key={`${row.number}-${row.name}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ flex: 1 }}>
                        <b>{player.name}</b> · {row.club ?? "sem clube"}
                      </span>
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={() => toggleRegistration(event.id, player.id)}
                      >
                        Adicionar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sync.unassociatedClubEntries.length > 0 && (
              <div>
                <div
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    color: "#8a6a1e",
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  ENTRADAS EFANOR POR ASSOCIAR
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  {sync.unassociatedClubEntries.map((row) => (
                    <div
                      key={`${row.number}-${row.name}`}
                      style={{ fontSize: 12.5 }}
                    >
                      <b>{row.name}</b>
                      {row.fideId ? ` · FIDE ${row.fideId}` : ""} ·{" "}
                      {row.club ?? "sem clube"}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          {data.players.map((player) => {
            const active = event.registrations.includes(player.id);
            const inChessResults = sync.chessResultsPlayerIds.has(player.id);
            const detail = sync.detailsByPlayerId.get(player.id);
            return (
              <div
                key={player.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 22px",
                  borderBottom: "1px solid #f4eee7",
                }}
              >
                <span
                  className="avatar"
                  style={{ background: "#f4eee7", color: "var(--ink)" }}
                >
                  {initials(player.name)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {player.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginTop: 3,
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: "var(--soft)" }}>
                      {player.category}
                    </span>
                    {active && (
                      <RegistrationPill status={detail?.status ?? "selected"} />
                    )}
                    {inChessResults && (
                      <SyncPill tone="green">Chess-Results</SyncPill>
                    )}
                    {active &&
                      sync.hasChessResultsStartList &&
                      !inChessResults && (
                        <SyncPill tone="amber">ausente no CR</SyncPill>
                      )}
                    {!active && inChessResults && (
                      <SyncPill tone="amber">no CR</SyncPill>
                    )}
                  </div>
                </div>
                <button
                  className={`btn btn-small ${active ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => toggleRegistration(event.id, player.id)}
                >
                  {active
                    ? detail?.status === "confirmed" || inChessResults
                      ? "Confirmado ✓"
                      : "Inscrito ✓"
                    : "Inscrever"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderTeamEvent(event: EventRecord, phase: "completed" | "ongoing") {
    const teamRows = buildTeamStandingRows(event);
    const teamMembers = event.teamMembers ?? [];
    const eventMedals = data.medals.filter(
      (medal) => medal.eventId === event.id,
    );
    const podiumTeamNames = teamRows
      .filter((team) => team.position <= 3)
      .map((team) => team.name);
    const clubTeamNames = uniqueStrings(
      teamMembers
        .filter((member) => findTeamMemberPlayer(member, data.players))
        .map((member) => member.teamName),
    );
    const featuredTeamNames = uniqueStrings([
      ...podiumTeamNames,
      ...clubTeamNames,
    ]);

    return (
      <div className="panel">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--pink)", fontSize: 18 }}>♚</span>
            <h3
              className="disp"
              style={{ margin: 0, fontSize: 18, fontWeight: 800 }}
            >
              {phase === "completed"
                ? "Classificação final por equipas"
                : "Classificação por equipas"}
            </h3>
          </div>
          <span className="mono" style={{ fontSize: 10, color: "#a89e94" }}>
            TROFÉUS ATRIBUÍDOS A ATLETAS
          </span>
        </div>
        {teamRows.length ? (
          <div className="table-card">
            <div className="table-head grid-team-ranking">
              <span>#</span>
              <span>EQUIPA</span>
              <span style={{ textAlign: "right" }}>MP</span>
              <span style={{ textAlign: "right" }}>PTS TAB.</span>
            </div>
            {teamRows.map((team) => {
              const hasClubPlayer = teamHasClubPlayer(
                team.name,
                teamMembers,
                data.players,
              );
              return (
                <div
                  key={`${team.position}-${team.name}`}
                  className={`table-row grid-team-ranking ${hasClubPlayer ? "highlight" : ""}`}
                >
                  <span>
                    {team.position <= 3 ? (
                      <MedalIcon
                        type={teamMedalTypeForPosition(team.position)!}
                        size={30}
                        label={team.position}
                      />
                    ) : (
                      <span
                        className="avatar"
                        style={{
                          width: 30,
                          height: 30,
                          background: hasClubPlayer ? "#f6e1ef" : "#f4eee7",
                          color: hasClubPlayer ? "var(--pink)" : "#a89e94",
                        }}
                      >
                        {team.position}
                      </span>
                    )}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <b>{team.name}</b>
                      {hasClubPlayer && (
                        <SyncPill tone="green">atleta do clube</SyncPill>
                      )}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: "var(--soft)",
                        marginTop: 3,
                      }}
                    >
                      {team.seed ? `Seed ${team.seed} · ` : ""}
                      {team.played ? `${team.played} jogos · ` : ""}
                      {team.wins !== undefined ||
                      team.draws !== undefined ||
                      team.losses !== undefined
                        ? `${team.wins ?? 0}-${team.draws ?? 0}-${team.losses ?? 0}`
                        : team.tieBreaks?.length
                          ? `Desempates ${team.tieBreaks.join(" · ")}`
                          : "Equipa"}
                    </div>
                  </div>
                  <span
                    className="mono"
                    style={{
                      textAlign: "right",
                      fontWeight: 800,
                      color: hasClubPlayer ? "var(--pink)" : "var(--text)",
                    }}
                  >
                    {team.matchPoints ?? "—"}
                  </span>
                  <span
                    className="mono"
                    style={{ textAlign: "right", fontWeight: 800 }}
                  >
                    {team.boardPoints ?? team.tieBreaks?.at(-1) ?? "—"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: "var(--muted)" }}>
            Sem classificação por equipas importada.
          </p>
        )}
        {featuredTeamNames.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginTop: 18,
            }}
          >
            {featuredTeamNames.map((teamName) =>
              renderTeamRosterCard(
                event,
                teamName,
                teamRows.find((team) => sameTeamName(team.name, teamName)),
                teamMembers.filter((member) =>
                  sameTeamName(member.teamName, teamName),
                ),
                eventMedals,
              ),
            )}
          </div>
        )}
        <p
          style={{
            margin: "11px 0 0",
            fontSize: 11.5,
            color: "var(--soft)",
            lineHeight: 1.5,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              borderRadius: 3,
              background: "var(--pink)",
              marginRight: 5,
            }}
          />
          A posição é da <b>equipa</b>. As medalhas/troféus ficam guardadas no
          perfil dos atletas dessa equipa.
        </p>
      </div>
    );
  }

  function renderTeamRosterCard(
    event: EventRecord,
    teamName: string,
    standing: EventTeamStanding | undefined,
    members: EventTeamMember[],
    eventMedals: Medal[],
  ) {
    const teamMedalType = teamMedalTypeForPosition(standing?.position);
    return (
      <div
        key={teamName}
        style={{
          border: "1px solid #f1ebe4",
          borderRadius: 13,
          overflow: "hidden",
          background: "#fffdfb",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "13px 16px",
            background: "#fbf6f0",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="disp" style={{ fontSize: 15, fontWeight: 800 }}>
              {teamName}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "#a89e94" }}>
              {standing?.position
                ? `${standing.position}.º por equipas`
                : "Composição da equipa"}
              {standing?.matchPoints ? ` · ${standing.matchPoints} MP` : ""}
            </div>
          </div>
          {teamMedalType && (
            <span
              className="status-pill"
              style={{ background: "#fbe7f2", color: "var(--pink)" }}
            >
              <MedalIcon type={teamMedalType} size={15} />
              {teamMedalLabel(teamMedalType, teamName)}
            </span>
          )}
        </div>
        {members.length ? (
          <div>
            <div className="table-head grid-team-roster">
              <span>TAB.</span>
              <span>ATLETA</span>
              <span style={{ textAlign: "right" }}>ELO</span>
              <span style={{ textAlign: "right" }}>PTS</span>
              <span style={{ textAlign: "right" }}>RP</span>
            </div>
            {members.map((member) => {
              const player = findTeamMemberPlayer(member, data.players);
              const badges = player
                ? eventMedals.filter((medal) => medal.playerId === player.id)
                : [];
              const defaultType = teamMedalType ?? "gold";
              return (
                <div
                  key={`${member.teamName}-${member.board ?? member.name}`}
                  className={`table-row grid-team-roster ${player ? "highlight" : ""}`}
                >
                  <span
                    className="mono"
                    style={{ color: "var(--pink)", fontWeight: 800 }}
                  >
                    {member.board ?? "—"}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={() => player && openPlayer(player.id)}
                        style={{
                          border: 0,
                          background: "none",
                          padding: 0,
                          fontWeight: player ? 800 : 700,
                          cursor: player ? "pointer" : "default",
                          textAlign: "left",
                        }}
                      >
                        {member.title ? `${member.title} ` : ""}
                        {member.name}
                      </button>
                      {badges.map((medal) => (
                        <span
                          key={medal.id}
                          className="status-pill"
                          style={{
                            background: "#fbe7f2",
                            color: "var(--pink)",
                          }}
                        >
                          <MedalIcon type={medal.type} size={15} />
                          {medal.label ?? medalLabel(medal)}
                          {canEdit && medal.source === "manual" && (
                            <button
                              onClick={() => removeMedal(medal.id)}
                              style={{
                                border: 0,
                                background: "none",
                                color: "var(--pink)",
                                cursor: "pointer",
                              }}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {player && canEdit && (
                        <button
                          className="btn btn-small btn-soft"
                          onClick={() =>
                            setAward({
                              eventId: event.id,
                              playerId: player.id,
                              playerName: player.name,
                              type: defaultType,
                              label: teamMedalType
                                ? teamMedalLabel(teamMedalType, teamName)
                                : `Prémio por equipas · ${teamName}`,
                              teamName: teamMedalType ? teamName : undefined,
                            })
                          }
                        >
                          + troféu
                        </button>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: player ? "var(--pink)" : "#a89e94",
                        marginTop: 3,
                      }}
                    >
                      {player
                        ? "Atleta EFANOR"
                        : (member.federation ?? teamName)}
                    </div>
                  </div>
                  <span
                    className="mono"
                    style={{ textAlign: "right", fontWeight: 800 }}
                  >
                    {member.rating ?? "—"}
                  </span>
                  <span
                    className="mono"
                    style={{ textAlign: "right", fontWeight: 800 }}
                  >
                    {member.points ?? "—"}
                    {member.games ? `/${member.games}` : ""}
                  </span>
                  <span
                    className="mono"
                    style={{ textAlign: "right", fontWeight: 800 }}
                  >
                    {member.performance ?? "—"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p
            style={{
              margin: 0,
              padding: 16,
              color: "var(--muted)",
              fontSize: 13,
            }}
          >
            Composição da equipa ainda não importada.
          </p>
        )}
      </div>
    );
  }

  function renderCompletedEvent(
    event: EventRecord,
    rows: ReturnType<typeof buildFinalRows>,
  ) {
    const eventMedals = data.medals.filter(
      (medal) => medal.eventId === event.id,
    );
    return (
      <div className="panel">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ color: "var(--pink)", fontSize: 18 }}>♕</span>
          <h3
            className="disp"
            style={{ margin: 0, fontSize: 18, fontWeight: 800 }}
          >
            Classificação final
          </h3>
        </div>
        {rows.length ? (
          <div className="table-card">
            <div className="table-head grid-ranking">
              <span>#</span>
              <span>ATLETA · CLUBE</span>
              <span style={{ textAlign: "right" }}>PTS</span>
            </div>
            {rows.map((row) => {
              const player = findTournamentPlayer(
                data.players,
                row,
                event.initialRanking,
              );
              const isUs = row.us || Boolean(player) || isEfanorClub(row.club);
              const badges = player
                ? eventMedals.filter((medal) => medal.playerId === player.id)
                : [];
              return (
                <div
                  key={`${row.pos}-${row.name}`}
                  className={`table-row grid-ranking ${isUs ? "highlight" : ""}`}
                >
                  <span>
                    {row.pos <= 3 ? (
                      <MedalIcon
                        type={
                          row.pos === 1
                            ? "gold"
                            : row.pos === 2
                              ? "silver"
                              : "bronze"
                        }
                        size={30}
                        label={row.pos}
                      />
                    ) : (
                      <span
                        className="avatar"
                        style={{
                          width: 30,
                          height: 30,
                          background: isUs ? "#f6e1ef" : "#f4eee7",
                          color: isUs ? "var(--pink)" : "#a89e94",
                        }}
                      >
                        {row.pos}
                      </span>
                    )}
                  </span>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={() => player && openPlayer(player.id)}
                        style={{
                          border: 0,
                          background: "none",
                          padding: 0,
                          fontWeight: isUs ? 800 : 700,
                          cursor: player ? "pointer" : "default",
                        }}
                      >
                        {row.name}
                      </button>
                      {badges.map((medal) => (
                        <span
                          key={medal.id}
                          className="status-pill"
                          style={{
                            background: "#fbe7f2",
                            color: "var(--pink)",
                          }}
                        >
                          <MedalIcon type={medal.type} size={15} />
                          {medal.label ?? medalLabel(medal)}
                          {canEdit && medal.source === "manual" && (
                            <button
                              onClick={() => removeMedal(medal.id)}
                              style={{
                                border: 0,
                                background: "none",
                                color: "var(--pink)",
                                cursor: "pointer",
                              }}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {isUs && canEdit && player && (
                        <button
                          className="btn btn-small btn-soft"
                          onClick={() =>
                            setAward({
                              eventId: event.id,
                              playerId: player.id,
                              playerName: player.name,
                              type: "gold",
                              label: "1.º lugar",
                            })
                          }
                        >
                          + medalha
                        </button>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: isUs ? "var(--pink)" : "#a89e94",
                        fontWeight: isUs ? 800 : 500,
                      }}
                    >
                      {isUs ? row.club || "Efanor" : row.club}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span
                      className="mono"
                      style={{
                        fontWeight: 800,
                        color: isUs ? "var(--pink)" : "var(--text)",
                      }}
                    >
                      {row.points}
                    </span>
                    {row.delta && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 12,
                          marginLeft: 8,
                          color: "var(--pink)",
                        }}
                      >
                        {row.delta}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: "var(--muted)" }}>Sem classificação importada.</p>
        )}
        <p
          style={{
            margin: "11px 0 0",
            fontSize: 11.5,
            color: "var(--soft)",
            lineHeight: 1.5,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              borderRadius: 3,
              background: "var(--pink)",
              marginRight: 5,
            }}
          />
          Atletas <b>EFANOR</b> destacados · pódio com medalha. Moderadores
          podem atribuir medalhas extra.
        </p>
      </div>
    );
  }

  function renderOngoingEvent(event: EventRecord) {
    const live = event.live;
    if (!live)
      return (
        <EmptyState
          title="Sem dados ao vivo"
          body="A sincronização Chess-Results ainda não encontrou emparelhamentos."
        />
      );
    return (
      <>
        <div className="table-card">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "18px 22px",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span className="live-dot" />
              <h3
                className="disp"
                style={{ margin: 0, fontSize: 18, fontWeight: 800 }}
              >
                Próximos emparelhamentos
              </h3>
            </div>
            <span
              className="mono status-pill"
              style={{ color: "#2f9e54", background: "#e6f4ec" }}
            >
              {live.nextRound}
            </span>
          </div>
          <p
            style={{
              margin: 0,
              padding: "0 22px 14px",
              color: "var(--muted)",
              fontSize: 13,
            }}
          >
            Mesas dos <b>nossos atletas</b> destacadas. Ronda {live.round} /{" "}
            {live.totalRounds} concluída.
          </p>
          <div className="table-head grid-pairings">
            <span>MESA</span>
            <span>BRANCAS</span>
            <span></span>
            <span>PRETAS</span>
          </div>
          {live.pairings.map((pairing) => (
            <div
              key={pairing.board}
              className={`table-row grid-pairings ${pairing.whiteUs || pairing.blackUs ? "highlight" : ""}`}
            >
              <span
                className="mono"
                style={{ fontWeight: 800, color: "var(--pink)" }}
              >
                {pairing.board}
              </span>
              <span style={{ fontWeight: pairing.whiteUs ? 800 : 500 }}>
                {pairing.white}
              </span>
              <span
                style={{ color: "#c9c0b6", textAlign: "center", fontSize: 11 }}
              >
                vs
              </span>
              <span style={{ fontWeight: pairing.blackUs ? 800 : 500 }}>
                {pairing.black}
              </span>
            </div>
          ))}
        </div>
        <div className="table-card">
          <div style={{ padding: "18px 22px 14px" }}>
            <h3
              className="disp"
              style={{ margin: 0, fontSize: 18, fontWeight: 800 }}
            >
              Classificação ao vivo
            </h3>
            <div style={{ fontSize: 12.5, color: "var(--soft)" }}>
              Posição dos nossos atletas no torneio geral
            </div>
          </div>
          <div className="table-head grid-ranking">
            <span>POS</span>
            <span>JOGADOR</span>
            <span style={{ textAlign: "right" }}>PTS</span>
          </div>
          {live.standings.map((standing) => {
            const player = findTournamentPlayer(
              data.players,
              standing,
              event.initialRanking,
            );
            const isUs =
              standing.us || Boolean(player) || isEfanorClub(standing.club);
            return (
              <button
                key={`${standing.position}-${standing.name}`}
                className={`table-row grid-ranking ${isUs ? "highlight" : ""}`}
                style={{
                  width: "100%",
                  border: 0,
                  textAlign: "left",
                  background: isUs ? "#fbf1f8" : "#fff",
                  cursor: player ? "pointer" : "default",
                }}
                onClick={() => player && openPlayer(player.id)}
              >
                <span
                  className="disp"
                  style={{
                    fontWeight: 800,
                    color: isUs ? "var(--pink)" : "var(--text)",
                  }}
                >
                  {standing.position}
                </span>
                <span>
                  <b>{standing.name}</b>
                  <span
                    className="mono"
                    style={{ fontSize: 10.5, color: "#a89e94", marginLeft: 8 }}
                  >
                    {standing.club}
                  </span>
                </span>
                <span
                  className="mono"
                  style={{
                    textAlign: "right",
                    fontWeight: 800,
                    color: isUs ? "var(--pink)" : "var(--muted)",
                  }}
                >
                  {standing.points}
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  function renderInitialRankingPanel(event: EventRecord) {
    const rows = event.initialRanking ?? [];
    return (
      <div className="table-card">
        <div style={{ padding: "18px 22px 14px" }}>
          <h3
            className="disp"
            style={{ margin: 0, fontSize: 18, fontWeight: 800 }}
          >
            Ranking inicial
          </h3>
          <div style={{ fontSize: 12.5, color: "var(--soft)" }}>
            {event.initialRanking?.length ?? 0} entradas importadas de
            Chess-Results
          </div>
        </div>
        <div className="table-head grid-start-list">
          <span>Nº</span>
          <span>NOME</span>
          <span>FED</span>
          <span style={{ textAlign: "right" }}>ELO</span>
        </div>
        {rows.map((row) => {
          const player = findTournamentPlayer(data.players, row);
          const isUs = Boolean(player) || isEfanorClub(row.club);
          return (
            <div
              key={`${row.number}-${row.name}`}
              className={`table-row grid-start-list ${isUs ? "highlight" : ""}`}
              style={{ background: isUs ? "#fbf1f8" : "var(--cream)" }}
            >
              <span
                className="mono"
                style={{
                  color: isUs ? "var(--pink)" : "#7d746c",
                  fontWeight: 800,
                }}
              >
                {row.number ?? "—"}
              </span>
              <span style={{ minWidth: 0 }}>
                {player ? (
                  <button
                    type="button"
                    style={{
                      display: "block",
                      border: 0,
                      background: "none",
                      padding: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      fontWeight: 800,
                      color: "var(--text)",
                    }}
                    onClick={() => openPlayer(player.id)}
                  >
                    {row.title ? `${row.title} ` : ""}
                    {row.name}
                  </button>
                ) : (
                  <span
                    style={{
                      display: "block",
                      fontWeight: 650,
                      color: "var(--text)",
                    }}
                  >
                    {row.title ? `${row.title} ` : ""}
                    {row.name}
                  </span>
                )}
                <span
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginTop: 2,
                  }}
                >
                  {row.club && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 10.5,
                        color: isUs ? "var(--pink)" : "#7d746c",
                      }}
                    >
                      {row.club}
                    </span>
                  )}
                  <FideProfileLink fideId={row.fideId} />
                </span>
              </span>
              <span
                className="mono"
                style={{ color: isUs ? "var(--pink)" : "#7d746c" }}
              >
                {row.federation ?? "—"}
              </span>
              <span
                className="mono"
                style={{
                  textAlign: "right",
                  fontWeight: isUs ? 800 : 650,
                  color: "var(--text)",
                }}
              >
                {row.rating ?? "—"}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  function renderClubRules() {
    const rules = [
      "Todas as inscrições são feitas PELO CLUBE, nunca individualmente.",
      "É obrigatório estar EQUIPADO com o kit do clube em qualquer prova.",
      "O comprovativo/logística é tratado fora da aplicação.",
      "Transferência por IBAN / Revolut com o nome do aluno + nome da prova.",
    ];
    return (
      <div className="panel">
        <h3
          className="disp"
          style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 800 }}
        >
          Regras do clube
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rules.map((rule, index) => (
            <div
              key={rule}
              style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  background: "#fbe7f2",
                  color: "var(--pink)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "Archivo",
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {index + 1}
              </span>
              <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>{rule}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderRegisteredPlayers(sync: EventRegistrationSyncState) {
    const players = sync.registeredPlayers;
    const displayPlayers = players.length
      ? players
      : sync.importedMatchedPlayers;
    return (
      <div className="panel">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          <h3
            className="disp"
            style={{ margin: 0, fontSize: 18, fontWeight: 800 }}
          >
            Atletas inscritos
          </h3>
          <span className="mono" style={{ fontSize: 10, color: "#a89e94" }}>
            CLUBE · CHESS-RESULTS
          </span>
        </div>
        {displayPlayers.length ? (
          <div className="table-card">
            <div className="table-head grid-ranking">
              <span>#</span>
              <span>ATLETA EFANOR</span>
              <span style={{ textAlign: "right" }}>RATING</span>
            </div>
            {displayPlayers
              .slice()
              .sort((a, b) => b.combined - a.combined)
              .map((player, index) => {
                const detail = sync.detailsByPlayerId.get(player.id);
                const inChessResults = sync.chessResultsPlayerIds.has(
                  player.id,
                );
                return (
                  <button
                    key={player.id}
                    className="table-row grid-ranking highlight"
                    style={{
                      width: "100%",
                      border: 0,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                    onClick={() => openPlayer(player.id)}
                  >
                    <span
                      className="mono"
                      style={{ color: "var(--pink)", fontWeight: 800 }}
                    >
                      {index + 1}
                    </span>
                    <span>
                      <b>{player.name}</b>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                          flexWrap: "wrap",
                          marginTop: 3,
                        }}
                      >
                        <span style={{ fontSize: 11, color: "var(--soft)" }}>
                          {player.category}
                        </span>
                        {detail && <RegistrationPill status={detail.status} />}
                        {inChessResults && (
                          <SyncPill tone="green">Chess-Results</SyncPill>
                        )}
                        {players.length === 0 && (
                          <SyncPill tone="amber">a sincronizar</SyncPill>
                        )}
                      </div>
                    </span>
                    <span
                      className="mono"
                      style={{ textAlign: "right", fontWeight: 800 }}
                    >
                      {player.combined}
                    </span>
                  </button>
                );
              })}
          </div>
        ) : (
          <p style={{ margin: 0, color: "var(--soft)" }}>
            {canEdit
              ? "Ainda ninguém inscrito. Usa Gerir inscrições para adicionar atletas."
              : "Fala com o teu treinador para entrares."}
          </p>
        )}
        {sync.hasChessResultsStartList &&
          sync.missingFromChessResults.length > 0 && (
            <p style={{ margin: "10px 0 0", color: "#8a6a1e", fontSize: 12.5 }}>
              {sync.missingFromChessResults.length} selecionado(s) pelo clube
              ainda não aparecem no Chess-Results.
            </p>
          )}
      </div>
    );
  }

  function renderFide() {
    const medalsByPlayerId = Object.fromEntries(
      data.players.map((player) => [player.id, medalMap[player.id]?.length ?? 0]),
    );
    const rows = buildFideRankingRows(
      data.players,
      selectedFideMonth,
      fideType,
      medalsByPlayerId,
    )
      .filter((player) =>
        player.name.toLowerCase().includes(search.toLowerCase()),
      )
      .filter((row) => row[fideType] > 0)
      .sort((a, b) =>
        fideSort === "medals"
          ? b.medals - a.medals || b.combined - a.combined
          : b[fideSort] - a[fideSort],
      );
    const groups = fideGroup
      ? groupFideRankingRows(rows)
      : [{ label: "", rows }];
    return (
      <div className="container mid">
        <div className="filters">
          <FilterSelect
            label="MÊS"
            value={String(selectedFideMonthIndex)}
            onChange={(value) => setFideMonth(Number(value))}
            options={
              fideMonths.length
                ? fideMonths
                    .map((month, index): [string, string] => [
                      String(index),
                      month.label,
                    ])
                    .reverse()
                : [["0", "Sem histórico"]]
            }
          />
          <div className="chips">
            {(["combined", "standard", "rapid", "blitz"] as const).map(
              (type) => (
                <button
                  key={type}
                  className={`chip ${fideType === type ? "active" : ""}`}
                  onClick={() => {
                    setFideType(type);
                    setFideSort(type);
                  }}
                >
                  {type === "combined" ? "Combinado" : TYPE_LABEL[type]}
                </button>
              ),
            )}
          </div>
          <button
            className={`chip ${fideGroup ? "active" : ""}`}
            onClick={() => setFideGroup((value) => !value)}
          >
            ⊞ Agrupar por escalão
          </button>
          <div style={{ flex: 1 }} />
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Procurar atleta…"
            style={{ maxWidth: 230 }}
          />
        </div>
        <div className="table-card">
          <div className="table-head grid-fide">
            <span>#</span>
            <span>ATLETA</span>
            <span>ESCALÃO</span>
            <button
              className="table-sort"
              onClick={() => setFideSort("medals")}
            >
              MEDALHAS ⇅
            </button>
            <button
              className="table-sort"
              onClick={() => setFideSort("standard")}
            >
              CLÁS. ⇅
            </button>
            <button className="table-sort" onClick={() => setFideSort("rapid")}>
              S/RÁP. ⇅
            </button>
            <button className="table-sort" onClick={() => setFideSort("blitz")}>
              RÁP. ⇅
            </button>
            <button
              className="table-sort"
              onClick={() => setFideSort("combined")}
            >
              COMBINADO ⇅
            </button>
          </div>
          {groups.map((group) => (
            <div key={group.label || "all"}>
              {group.label && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 22px",
                    background: "#fbf6f0",
                    borderTop: "1px solid #f1ebe4",
                  }}
                >
                  <span
                    className="disp"
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: "var(--pink)",
                    }}
                  >
                    {group.label}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: "#a89e94" }}
                  >
                    {group.rows.length} atletas
                  </span>
                  <div style={{ flex: 1, height: 1, background: "#f1ebe4" }} />
                </div>
              )}
              {group.rows.map((player, index) => (
                <button
                  key={player.id}
                  className="table-row grid-fide"
                  style={{
                    width: "100%",
                    borderLeft: 0,
                    borderRight: 0,
                    borderBottom: 0,
                    textAlign: "left",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                  onClick={() => openPlayer(player.id)}
                >
                  <span
                    className="disp"
                    style={{
                      fontWeight: 800,
                      color:
                        (group.label ? player.groupRank : player.rank) <= 3 && !group.label
                          ? "var(--pink)"
                          : "var(--text)",
                    }}
                  >
                    {group.label ? player.groupRank : player.rank}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {player.name}
                    </span>
                    <RankTrend
                      delta={fideGroup ? player.groupRankDelta : player.rankDelta}
                      scope={fideGroup ? "escalão" : "ranking absoluto"}
                    />
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {player.category}
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    {(["gold", "silver", "bronze"] as const).map((type) => (
                      <MedalCount
                        key={type}
                        type={type}
                        count={countMedals(data.medals, player.id, type)}
                      />
                    ))}
                  </span>
                  <RatingCell
                    value={player.standard}
                    delta={player.deltaStandard}
                  />
                  <RatingCell value={player.rapid} delta={player.deltaRapid} />
                  <RatingCell value={player.blitz} delta={player.deltaBlitz} />
                  <RatingCell
                    value={player.combined}
                    delta={player.deltaCombined}
                  />
                </button>
              ))}
            </div>
          ))}
        </div>
        <p
          className="mono"
          style={{
            fontSize: 10.5,
            color: "#a89e94",
            marginTop: 12,
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Medalhas contam os pódios do clube em provas concluídas. Clica em
          MEDALHAS para ordenar.
        </p>
      </div>
    );
  }

  function renderPlayer() {
    if (!selectedPlayer) return null;
    const playerMedals = data.medals.filter(
      (medal) => medal.playerId === selectedPlayer.id,
    );
    const liveEvent = data.events.find(
      (event) =>
        event.status === "ongoing" &&
        event.live?.standings.some(
          (standing) => standing.name === selectedPlayer.name,
        ),
    );
    const playerGames = gamesForPlayer(data.games, selectedPlayer);
    const currentSeason = currentClubSeason(data.events);
    const seasonMedals = currentSeason
      ? playerMedals.filter(
          (medal) =>
            data.events.find((event) => event.id === medal.eventId)?.season ===
            currentSeason,
        )
      : playerMedals;
    const playerTitles = countMedalsList(playerMedals, "gold");
    const latestRanking = playerLatestRanking(
      selectedPlayer,
      data.players,
      selectedFideMonth,
      medalMap,
    );
    const recentEvents = data.events
      .filter((event) => event.status === "completed")
      .filter((event) => playerParticipatedInEvent(event, selectedPlayer, data.players))
      .sort((a, b) => eventDateValue(b) - eventDateValue(a))
      .slice(0, 5);
    return (
      <div className="container narrow">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <button
            className="btn btn-ghost btn-small"
            onClick={() => go("fide")}
          >
            ‹ Voltar ao leaderboard
          </button>
          <button
            className="btn btn-soft btn-small"
            onClick={() => setCalendarPlayerId(selectedPlayer.id)}
          >
            Calendário
          </button>
        </div>
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            borderRadius: 18,
            padding: "24px 28px",
            marginBottom: 18,
            overflow: "hidden",
          }}
        >
          <span
            className="avatar"
            style={{ width: 72, height: 72, borderRadius: 16, fontSize: 26 }}
          >
            {initials(selectedPlayer.name)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              className="disp"
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 800,
                lineHeight: 1.05,
              }}
            >
              {selectedPlayer.name}
            </h2>
            <div
              style={{
                display: "flex",
                gap: 14,
                marginTop: 6,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                {selectedPlayer.category}
              </span>
              {selectedPlayer.fideId && (
                <a
                  href={`https://ratings.fide.com/profile/${selectedPlayer.fideId}`}
                  target="_blank"
                  className="mono"
                  style={{
                    color: "var(--pink)",
                    textDecoration: "none",
                    fontWeight: 800,
                  }}
                >
                  FIDE {selectedPlayer.fideId} ↗
                </a>
              )}
              {selectedPlayer.profileStatus === "incomplete" && (
                <span
                  className="status-pill"
                  title={profileMissingText(selectedPlayer.missingFields)}
                  style={{ background: "#fcebc4", color: "#9a7a2e" }}
                >
                  Perfil incompleto
                </span>
              )}
            </div>
            {selectedPlayer.profileStatus === "incomplete" && (
              <div style={{ fontSize: 12, color: "#9a7a2e", marginTop: 7 }}>
                {profileMissingText(selectedPlayer.missingFields)}
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", minWidth: 150 }}>
            <div
              className="mono"
              style={{ fontSize: 10, letterSpacing: ".12em", color: "#a89e94" }}
            >
              RANKING CLUBE
            </div>
            <div
              className="disp"
              style={{
                fontSize: 34,
                fontWeight: 800,
                lineHeight: 1,
                color: "var(--pink)",
              }}
            >
              {latestRanking?.rank ? `${latestRanking.rank}.º` : "—"}
            </div>
            <div
              className="mono"
              style={{ fontSize: 10.5, color: "#a89e94", marginTop: 7 }}
            >
              ESCALÃO · {latestRanking?.groupRank ? `${latestRanking.groupRank}.º` : "—"}
            </div>
          </div>
        </div>
        {liveEvent && renderPlayerLive(selectedPlayer, liveEvent)}
        <div className="three-col" style={{ marginBottom: 18 }}>
          {(["standard", "rapid", "blitz"] as EventType[]).map((type) => (
            <div
              key={type}
              className="card"
              style={{
                padding: "18px 20px",
                borderTop: `3px solid ${type === "standard" ? "var(--ink)" : type === "rapid" ? "var(--pink)" : "var(--red)"}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    fontWeight: 700,
                  }}
                >
                  {TYPE_LABEL[type]}
                </span>
                <RatingDeltaBadge
                  delta={ratingDeltaForType(latestRanking, type)}
                />
              </div>
              <div
                className="disp"
                style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}
              >
                {selectedPlayer[type] || " | "}
              </div>
            </div>
          ))}
        </div>
        <div className="panel" style={{ marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <h3
              className="disp"
              style={{ margin: 0, fontSize: 18, fontWeight: 800 }}
            >
              Evolução do rating
            </h3>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Legend color="var(--ink)" label="Clássicas" />
              <Legend color="var(--pink)" label="Semi-Rápidas" />
              <Legend color="var(--red)" label="Rápidas" />
            </div>
          </div>
          <RatingChart player={selectedPlayer} />
        </div>
        <div className="panel" style={{ marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <h3
              className="disp"
              style={{ margin: 0, fontSize: 18, fontWeight: 800 }}
            >
              Pódios
            </h3>
            <span className="mono" style={{ fontSize: 11, color: "#a89e94" }}>
              {seasonMedals.length} em {currentSeason ?? "esta época"} · {playerMedals.length} carreira · {playerTitles} título(s)
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 26,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {(["gold", "silver", "bronze"] as const).map((type) => (
              <div
                key={type}
                style={{ display: "flex", alignItems: "center", gap: 11 }}
              >
                <MedalIcon
                  type={type}
                  size={42}
                  label={countMedalsList(seasonMedals, type)}
                />
                <div>
                  <div
                    className="disp"
                    style={{ fontWeight: 800, fontSize: 20 }}
                  >
                    {countMedalsList(seasonMedals, type)}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--soft)" }}>
                    {type === "gold"
                      ? "Ouro"
                      : type === "silver"
                        ? "Prata"
                        : "Bronze"}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {playerMedals.length ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 9,
                marginTop: 18,
                paddingTop: 16,
                borderTop: "1px solid #f1ebe4",
              }}
            >
              <div
                className="mono"
                style={{ width: "100%", fontSize: 10, color: "#a89e94" }}
              >
                HISTÓRICO COMPLETO
              </div>
              {playerMedals.map((medal) => {
                const event = data.events.find((e) => e.id === medal.eventId);
                return (
                  <button
                    key={medal.id}
                    onClick={() => event && openEvent(event.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      background: "#f6f0e8",
                      border: 0,
                      borderRadius: 11,
                      padding: "8px 13px 8px 9px",
                      cursor: "pointer",
                      maxWidth: 280,
                    }}
                  >
                    <MedalIcon type={medal.type} size={28} />
                    <span
                      style={{
                        textAlign: "left",
                        lineHeight: 1.2,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          fontWeight: 800,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {event?.name ?? "Evento"} ›
                      </span>
                      <span style={{ fontSize: 10.5, color: "var(--soft)" }}>
                        {medal.label ?? medalLabel(medal)} · {event?.month}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p style={{ margin: "16px 0 0", color: "var(--soft)" }}>
              Ainda sem pódios registados.
            </p>
          )}
        </div>
        <div className="two-col">
          <div className="panel">
            <h3
              className="disp"
              style={{ margin: "0 0 14px", fontSize: 17, fontWeight: 800 }}
            >
              Provas recentes
            </h3>
            {recentEvents.length ? (
              recentEvents.map((event) => (
                <button
                  key={event.id}
                  onClick={() => openEvent(event.id)}
                  style={{
                    width: "100%",
                    border: 0,
                    background: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 0",
                    borderBottom: "1px solid #f4eee7",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <TypeBadge type={event.type} short />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b
                      style={{
                        fontSize: 13.5,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "block",
                      }}
                    >
                      {event.name}
                    </b>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "#a89e94" }}
                    >
                      {event.dateLabel}
                    </span>
                  </span>
                  <span className="mono" style={{ fontWeight: 800 }}>
                    {eventPlayerScore(event, selectedPlayer) ?? "—"}
                  </span>
                </button>
              ))
            ) : (
              <p style={{ margin: 0, color: "var(--soft)", fontSize: 13 }}>
                Ainda sem provas concluídas com participação registada.
              </p>
            )}
          </div>
          <div className="panel">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                gap: 10,
              }}
            >
              <h3
                className="disp"
                style={{ margin: 0, fontSize: 17, fontWeight: 800 }}
              >
                Partidas
              </h3>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <button
                  className="btn btn-ghost btn-small"
                  onClick={() => openPgnUpload(selectedPlayer)}
                >
                  ↑ Upload
                </button>
                <button
                  className="btn btn-ink btn-small"
                  onClick={() => downloadPgn(data.games)}
                  disabled={!data.games.length}
                  title="Descarrega todos os PGNs reais da base de dados"
                >
                  ↓ Download
                </button>
              </div>
            </div>
            {playerGames.length ? (
              playerGames.map((game) => (
                <button
                  key={game.id}
                  onClick={() => openGame(game.id, selectedPlayer.id)}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "#f6f0e8",
                    border: 0,
                    borderRadius: 11,
                    cursor: "pointer",
                    textAlign: "left",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <b style={{ fontSize: 13 }}>
                      {game.white} – {game.black}
                    </b>
                    <span
                      className="mono"
                      style={{
                        fontWeight: 800,
                        color: game.result === "1–0" ? "#3e7d3a" : "#a89e94",
                      }}
                    >
                      {game.result}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {game.event}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 10.5, color: "#a89e94", marginTop: 3 }}
                  >
                    {game.eco || "ECO por classificar"} · {Math.ceil(game.moves.length / 2)} lances
                  </div>
                </button>
              ))
            ) : (
              <p style={{ margin: 0, color: "var(--soft)", fontSize: 13 }}>
                Ainda não há partidas reais carregadas para este atleta.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderPlayerLive(player: Player, event: EventRecord) {
    const standing = event.live?.standings.find(
      (st) => st.name === player.name,
    );
    const pairing = event.live?.pairings.find(
      (p) => p.white === player.name || p.black === player.name,
    );
    return (
      <div
        className="panel"
        style={{
          marginBottom: 18,
          borderLeft: "4px solid #2f9e54",
          cursor: "pointer",
        }}
        onClick={() => openEvent(event.id)}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 12,
          }}
        >
          <span className="live-dot" />
          <h3
            className="disp"
            style={{ margin: 0, fontSize: 17, fontWeight: 800 }}
          >
            A jogar agora
          </h3>
          <span
            className="mono status-pill"
            style={{ color: "#2f9e54", background: "#e6f4ec" }}
          >
            AO VIVO
          </span>
          <span
            style={{
              marginLeft: "auto",
              color: "var(--pink)",
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            {event.name} ›
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 26,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <InfoMini
            label="POSIÇÃO"
            value={`${standing?.position ?? "—"}.º`}
            pink
          />
          <InfoMini label="PONTOS" value={standing?.points ?? "—"} />
          <div>
            <div
              className="mono"
              style={{ fontSize: 9.5, letterSpacing: ".1em", color: "#a89e94" }}
            >
              RONDA
            </div>
            <div style={{ fontWeight: 800, marginTop: 2 }}>
              Mesa {pairing?.board ?? " | "} · {pairing?.white ?? " | "} vs{" "}
              {pairing?.black ?? " | "}
            </div>
            <div style={{ fontSize: 11.5, color: "#2f9e54", fontWeight: 800 }}>
              {event.live?.nextRound}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderGame() {
    if (!selectedGame) return null;
    const moveCoords = moveCoordsForGame(selectedGame);
    const board = boardAt(moveCoords, ply);
    const curAnn = selectedGame.annotations[ply - 1] ?? "";
    const moveRows = [];
    for (let i = 0; i < selectedGame.moves.length; i += 2)
      moveRows.push([
        i,
        selectedGame.moves[i],
        selectedGame.moves[i + 1],
      ] as const);
    return (
      <div className="container mid">
        <button
          className="btn btn-ghost btn-small"
          style={{ marginBottom: 18 }}
          onClick={() => go("jogador")}
        >
          ‹ Voltar ao perfil
        </button>
        <div className="board-layout">
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div>
                <div className="disp" style={{ fontSize: 18, fontWeight: 800 }}>
                  {selectedGame.white}{" "}
                  <span style={{ color: "#a89e94" }}>vs</span>{" "}
                  {selectedGame.black}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "#a89e94", marginTop: 2 }}
                >
                  {selectedGame.event}
                </div>
              </div>
              <span
                className="mono"
                style={{ fontSize: 18, fontWeight: 800, color: "var(--pink)" }}
              >
                {selectedGame.result}
              </span>
            </div>
            <div className="chessboard">
              {board.map((piece, index) => {
                const row = Math.floor(index / 8);
                const col = index % 8;
                const dark = (row + col) % 2 === 1;
                const last = moveCoords[ply - 1];
                const hi = last
                  ? sqToIndex(last[0]) === index || sqToIndex(last[1]) === index
                  : false;
                return (
                  <div
                    key={index}
                    className={`square ${dark ? "dark" : "light"} ${hi ? "hi" : ""}`}
                  >
                    <span
                      className="piece"
                      style={{
                        color: piece?.startsWith("w") ? "#fbfaf6" : "#1a1814",
                        textShadow: piece?.startsWith("w")
                          ? "0 1px 2px rgba(0,0,0,.45)"
                          : "none",
                      }}
                    >
                      {piece ? PIECES[piece] : ""}
                    </span>
                    {row === 7 && (
                      <span
                        className="mono"
                        style={{
                          position: "absolute",
                          left: 3,
                          top: 2,
                          fontSize: 9,
                          color: "rgba(20,20,18,.5)",
                        }}
                      >
                        {"abcdefgh"[col]}
                      </span>
                    )}
                    {col === 7 && (
                      <span
                        className="mono"
                        style={{
                          position: "absolute",
                          right: 3,
                          bottom: 1,
                          fontSize: 9,
                          color: "rgba(20,20,18,.5)",
                        }}
                      >
                        {8 - row}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="panel"
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span className="mono" style={{ fontSize: 11, color: "#a89e94" }}>
                {selectedGame.eco}
              </span>
              <span
                className="mono"
                style={{ fontSize: 12, color: "var(--muted)" }}
              >
                {ply} / {selectedGame.moves.length}
              </span>
            </div>
            <div style={{ maxHeight: 230, overflowY: "auto" }}>
              {moveRows.map(([index, white, black]) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "30px 1fr 1fr",
                    gap: 6,
                    alignItems: "center",
                    padding: "1px 0",
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: "#a89e94" }}
                  >
                    {index / 2 + 1}.
                  </span>
                  <MoveButton index={index} san={white} game={selectedGame} />
                  <MoveButton
                    index={index + 1}
                    san={black}
                    game={selectedGame}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setPly(0)}
              >
                ⏮
              </button>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setPly((value) => Math.max(0, value - 1))}
              >
                ‹
              </button>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() =>
                  setPly((value) =>
                    Math.min(selectedGame.moves.length, value + 1),
                  )
                }
              >
                ›
              </button>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setPly(selectedGame.moves.length)}
              >
                ⏭
              </button>
            </div>
            <div
              style={{
                background: "#f6f0e8",
                borderRadius: 12,
                padding: "15px 16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "#a89e94" }}
                >
                  ANOTAÇÃO
                </span>
                {ply > 0 && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: "var(--pink)",
                    }}
                  >
                    {selectedGame.moves[ply - 1]}
                  </span>
                )}
              </div>
              {canEdit ? (
                <>
                  <textarea
                    className="textarea"
                    value={annotationDraft}
                    onChange={(event) => setAnnotationDraft(event.target.value)}
                    placeholder="Escreve a tua análise deste lance…"
                  />
                  <button
                    className="btn btn-ink"
                    style={{ width: "100%", marginTop: 8 }}
                    onClick={saveAnnotation}
                  >
                    Guardar anotação
                  </button>
                </>
              ) : curAnn ? (
                <p style={{ margin: 0, lineHeight: 1.5 }}>{curAnn}</p>
              ) : (
                <p style={{ margin: 0, color: "var(--soft)" }}>
                  Sem anotação para este lance.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function MoveButton({
    index,
    san,
    game,
  }: {
    index: number;
    san?: string;
    game: GameRecord;
  }) {
    if (!san) return <span />;
    const active = ply - 1 === index;
    return (
      <button
        className={`move-pill ${active ? "active" : ""}`}
        onClick={() => {
          setPly(index + 1);
          setAnnotationDraft(game.annotations[index] ?? "");
        }}
      >
        {san}
        {game.annotations[index] && (
          <span style={{ color: active ? "#fff" : "var(--pink)", fontSize: 9 }}>
            ●
          </span>
        )}
      </button>
    );
  }

  function renderTrophies() {
    const trophySeasonOptions = trophySeasonsFromEvents(data.events);
    const activeTrophySeason = trophySeasonOptions.includes(trophySeason)
      ? trophySeason
      : "Todas";
    const medals =
      activeTrophySeason === "Todas"
        ? data.medals
        : data.medals.filter(
            (medal) =>
              data.events.find((event) => event.id === medal.eventId)
                ?.season === activeTrophySeason,
          );
    const rows = data.players
      .map((player) => ({
        player,
        medals: medals.filter((medal) => medal.playerId === player.id),
      }))
      .filter((row) => row.medals.length)
      .sort(
        (a, b) =>
          countMedalsList(b.medals, "gold") -
            countMedalsList(a.medals, "gold") ||
          countMedalsList(b.medals, "silver") -
            countMedalsList(a.medals, "silver") ||
          countMedalsList(b.medals, "bronze") -
            countMedalsList(a.medals, "bronze"),
      );
    const top = rows.slice(0, 3);
    const totals = {
      gold: countMedalsList(medals, "gold"),
      silver: countMedalsList(medals, "silver"),
      bronze: countMedalsList(medals, "bronze"),
    };
    return (
      <div className="container mid">
        <div
          className="banner"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            borderRadius: 16,
            padding: "22px 26px",
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 30 }}>★</span>
          <div>
            <h2
              className="disp"
              style={{ margin: 0, fontSize: 24, fontWeight: 800 }}
            >
              Sala de Troféus
            </h2>
            <p
              style={{
                margin: "5px 0 0",
                fontSize: 13.5,
                color: "rgba(255,255,255,.88)",
              }}
            >
              Pódios conquistados pelos atletas do clube{" "}
              <b>
                {activeTrophySeason === "Todas"
                  ? "todas as temporadas"
                  : `temporada ${activeTrophySeason}`}
              </b>
              .
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 18 }}>
            {(["gold", "silver", "bronze"] as const).map((type) => (
              <div key={type} style={{ textAlign: "center" }}>
                <MedalIcon type={type} size={46} label={totals[type]} />
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,.85)",
                    marginTop: 5,
                    fontWeight: 700,
                  }}
                >
                  {type === "gold"
                    ? "Ouro"
                    : type === "silver"
                      ? "Prata"
                      : "Bronze"}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="filters">
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: ".1em", color: "#a89e94" }}
          >
            TEMPORADA
          </span>
          <select
            className="select"
            value={activeTrophySeason}
            onChange={(event) => setTrophySeason(event.target.value)}
            style={{ maxWidth: 150 }}
          >
            {trophySeasonOptions.map((season) => (
              <option key={season}>{season}</option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: ".1em", color: "#a89e94" }}
          >
            RESUMO DE SEMPRE
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#fbf6f0",
              border: "1px solid #f1ebe4",
              borderRadius: 11,
              padding: "7px 14px",
            }}
          >
            {(["gold", "silver", "bronze"] as const).map((type) => (
              <MedalIcon
                key={type}
                type={type}
                size={26}
                label={countMedalsList(data.medals, type)}
              />
            ))}
            <span style={{ width: 1, height: 18, background: "#e4dcd4" }} />
            <span
              className="disp"
              style={{ fontSize: 16, fontWeight: 800, color: "var(--pink)" }}
            >
              {data.medals.length}
            </span>
            <span style={{ fontSize: 11, color: "var(--soft)" }}>
              medalhas · {new Set(data.medals.map((m) => m.playerId)).size}{" "}
              atletas
            </span>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="Ainda sem troféus"
            body="Assim que houver pódios em provas concluídas, aparecem aqui."
          />
        ) : (
          <>
            <div
              className="card"
              style={{
                borderRadius: 16,
                padding: "26px 28px 0",
                marginBottom: 18,
              }}
            >
              <h3
                className="disp"
                style={{
                  margin: "0 0 20px",
                  fontSize: 17,
                  fontWeight: 800,
                  textAlign: "center",
                }}
              >
                Pódio do clube · medalhas de ouro
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 16,
                  alignItems: "end",
                  maxWidth: 620,
                  margin: "0 auto",
                }}
              >
                {[top[1], top[0], top[2]].filter(Boolean).map((row, i) => {
                  const place = i === 0 ? 2 : i === 1 ? 1 : 3;
                  return (
                    <button
                      key={row.player.id}
                      onClick={() => openPlayer(row.player.id)}
                      style={{
                        border: 0,
                        background: "none",
                        textAlign: "center",
                        cursor: "pointer",
                      }}
                    >
                      <MedalIcon
                        type={
                          place === 1
                            ? "gold"
                            : place === 2
                              ? "silver"
                              : "bronze"
                        }
                        size={52}
                        label={place}
                      />
                      <div
                        className="disp"
                        style={{ fontSize: 15, fontWeight: 800, marginTop: 10 }}
                      >
                        {row.player.name}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: "#a89e94",
                          marginBottom: 10,
                        }}
                      >
                        {row.medals.length} medalhas
                      </div>
                      <div
                        style={{
                          height: place === 1 ? 128 : place === 2 ? 96 : 74,
                          borderRadius: "12px 12px 0 0",
                          background:
                            place === 1
                              ? "linear-gradient(180deg,#FBE08A,#D9A93A)"
                              : place === 2
                                ? "linear-gradient(180deg,#EDEEF1,#B8BBC2)"
                                : "linear-gradient(180deg,#E8B07C,#BE824C)",
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "center",
                          paddingTop: 12,
                        }}
                      >
                        <span
                          className="disp"
                          style={{
                            fontWeight: 800,
                            fontSize: 30,
                            color: "rgba(255,255,255,.85)",
                          }}
                        >
                          {place}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="table-card">
              <div className="table-head grid-trophies">
                <span>#</span>
                <span>ATLETA</span>
                <span>MEDALHAS</span>
                <span style={{ textAlign: "right" }}>TOTAL</span>
              </div>
              {rows.map((row, index) => (
                <button
                  key={row.player.id}
                  className="table-row grid-trophies"
                  style={{
                    width: "100%",
                    borderLeft: 0,
                    borderRight: 0,
                    borderBottom: 0,
                    background: "#fff",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onClick={() => openPlayer(row.player.id)}
                >
                  <span
                    className="disp"
                    style={{
                      fontWeight: 800,
                      color: index < 3 ? "var(--pink)" : "var(--text)",
                    }}
                  >
                    {index + 1}
                  </span>
                  <span>
                    <b>{row.player.name}</b>
                    <div style={{ fontSize: 11, color: "var(--soft)" }}>
                      {row.player.category}
                    </div>
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    {(["gold", "silver", "bronze"] as const).map((type) => (
                      <MedalCount
                        key={type}
                        type={type}
                        count={countMedalsList(row.medals, type)}
                      />
                    ))}
                  </span>
                  <span
                    className="disp"
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      textAlign: "right",
                    }}
                  >
                    {row.medals.length}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  function renderManagement() {
    const incomplete = data.accounts.filter(
      (account) => account.profileStatus === "incomplete",
    ).length;
    return (
      <div className="container narrow">
        <div
          className="banner"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            borderRadius: 14,
            padding: "16px 22px",
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 24 }}>♚</span>
          <div>
            <div className="disp" style={{ fontWeight: 800, fontSize: 16 }}>
              Gestão de contas & permissões
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "rgba(255,255,255,.82)",
                marginTop: 2,
              }}
            >
              {
                data.accounts.filter((account) => account.status === "pending")
                  .length
              }{" "}
              conta(s) por aprovar · {incomplete} perfil(is) incompleto(s)
            </div>
          </div>
        </div>
        <div className="table-card">
          <div className="table-head grid-accounts">
            <span>NOME</span>
            <span>EMAIL</span>
            <span>PERFIL</span>
            <span>ESTADO</span>
            <span style={{ textAlign: "right" }}>AÇÕES</span>
          </div>
          {data.accounts.map((account) => (
            <div key={account.id} className="table-row grid-accounts">
              <span>
                <b>{account.name}</b>
                {account.profileStatus === "incomplete" && (
                  <div style={{ fontSize: 11, color: "#9a7a2e", marginTop: 2 }}>
                    Falta: {account.missingFields.join(", ") || "dados"}
                  </div>
                )}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {account.email}
              </span>
              <span>
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color:
                      account.role === "admin"
                        ? "var(--red)"
                        : account.role === "moderator"
                          ? "var(--pink)"
                          : "var(--muted)",
                  }}
                >
                  {account.role === "moderator"
                    ? "Moderador"
                    : account.role === "student"
                      ? "Aluno"
                      : "Admin"}
                </span>
                {account.profileStatus === "incomplete" && (
                  <span
                    className="status-pill"
                    style={{
                      marginTop: 6,
                      background: "#fcebc4",
                      color: "#9a7a2e",
                    }}
                  >
                    Incompleto
                  </span>
                )}
              </span>
              <span>
                <span
                  className="status-pill"
                  style={{
                    background:
                      account.status === "active"
                        ? "#e2ead9"
                        : account.status === "pending"
                          ? "#fcebc4"
                          : "#f0e7dc",
                    color:
                      account.status === "active"
                        ? "#52733f"
                        : account.status === "pending"
                          ? "#9a7a2e"
                          : "#a89e94",
                  }}
                >
                  {account.status === "active"
                    ? "Ativo"
                    : account.status === "pending"
                      ? "Pendente"
                      : "Desativado"}
                </span>
              </span>
              <div
                className="actions-cell"
                style={{
                  display: "flex",
                  gap: 7,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                {account.status !== "active" && (
                  <button
                    className="btn btn-small"
                    style={{ background: "#e4efda", color: "#4f7240" }}
                    onClick={() =>
                      setAccountPatch(account.id, { status: "active" })
                    }
                  >
                    ✓ Ativar
                  </button>
                )}
                <button
                  className="btn btn-small btn-soft"
                  onClick={() => openEdit(account)}
                >
                  ✎ Alterar
                </button>
                {account.status === "active" && account.role === "student" && (
                  <button
                    className="btn btn-small btn-ghost"
                    style={{ color: "#9a8a55" }}
                    onClick={() =>
                      setAccountPatch(account.id, { status: "disabled" })
                    }
                  >
                    ⊘ Desativar
                  </button>
                )}
                {isAdmin &&
                  account.role === "student" &&
                  account.status === "active" && (
                    <button
                      className="btn btn-small btn-ink"
                      onClick={() =>
                        setAccountPatch(account.id, { role: "moderator" })
                      }
                    >
                      ▲ Promover
                    </button>
                  )}
                {isAdmin && account.role === "moderator" && (
                  <button
                    className="btn btn-small btn-ghost"
                    onClick={() =>
                      setAccountPatch(account.id, { role: "student" })
                    }
                  >
                    ▼ Despromover
                  </button>
                )}
                <button
                  className="btn btn-small btn-ghost"
                  onClick={() => resetPassword(account)}
                >
                  ♙ Palavra-passe
                </button>
              </div>
            </div>
          ))}
        </div>
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: "#a89e94",
            marginTop: 14,
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Admins e moderadores podem repor manualmente a palavra-passe e
          comunicar ao encarregado. Perfis incompletos ficam sinalizados até
          serem concluídos.
        </p>
        <div className="panel" style={{ marginTop: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <h3
              className="disp"
              style={{ margin: 0, fontSize: 17, fontWeight: 800 }}
            >
              Estado dos workers
            </h3>
            <a className="btn btn-small btn-ink" href="/api/backups/latest">
              ↓ Download base de dados
            </a>
          </div>
          {data.workerRuns.length ? (
            data.workerRuns.map((run) => (
              <details
                key={run.id}
                style={{
                  padding: "10px 0",
                  borderBottom: "1px solid #f4eee7",
                }}
              >
                <summary
                  style={{
                    display: "grid",
                    gridTemplateColumns: "18px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <span aria-hidden style={{ color: "#a89e94" }}>▸</span>
                  <span>
                    <b>{workerTypeLabel(run.type)}</b>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {workerSummary(run)}
                    </div>
                  </span>
                  <span
                    className="status-pill"
                    style={workerStatusStyle(run.status)}
                  >
                    {workerStatusLabel(run.status)} · {run.updatedAt}
                  </span>
                </summary>
                {workerDetails(run) && (
                  <pre
                    style={{
                      margin: "10px 0 0",
                      padding: 12,
                      background: "#fbf6f0",
                      borderRadius: 10,
                      whiteSpace: "pre-wrap",
                      fontSize: 11,
                      color: "#6f665d",
                      overflow: "auto",
                    }}
                  >
                    {workerDetails(run)}
                  </pre>
                )}
              </details>
            ))
          ) : (
            <p style={{ margin: 0, color: "var(--soft)", fontSize: 13 }}>
              Ainda não há execuções registadas.
            </p>
          )}
        </div>
      </div>
    );
  }

  function renderModals() {
    return (
      <>
        {composeOpen && (
          <Modal title="Novo post-it" onClose={() => setComposeOpen(false)}>
            <Field label="Título">
              <input
                className="input"
                value={compose.title}
                onChange={(event) =>
                  setCompose((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Ex.: Convocatória CN Jovens"
              />
            </Field>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <label className="label" style={{ margin: 0 }}>
                  Recado · suporta Markdown
                </label>
                <button
                  className="btn btn-small btn-soft"
                  onClick={() => setMdHelpOpen((value) => !value)}
                >
                  i
                </button>
              </div>
              {mdHelpOpen && (
                <div
                  style={{
                    background: "#fbf1f8",
                    border: "1px solid #f3cce0",
                    borderRadius: 10,
                    padding: "12px 14px",
                    marginBottom: 9,
                    fontSize: 12.5,
                    lineHeight: 1.7,
                  }}
                >
                  <b>Markdown básico</b>
                  <br />
                  <code>**negrito**</code> · <code>*itálico*</code> ·{" "}
                  <code>- item</code> · <code>[texto](https://…)</code>
                </div>
              )}
              <textarea
                className="textarea"
                value={compose.body}
                onChange={(event) =>
                  setCompose((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
                placeholder="Escreve o aviso para o mural…"
              />
            </div>
            <Field label="Cor do papel">
              <div style={{ display: "flex", gap: 9 }}>
                {TINTS.map((tint) => (
                  <button
                    key={tint}
                    onClick={() =>
                      setCompose((current) => ({ ...current, tint }))
                    }
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: tint,
                      cursor: "pointer",
                      border:
                        compose.tint === tint
                          ? "3px solid var(--ink)"
                          : "3px solid rgba(0,0,0,.06)",
                    }}
                  />
                ))}
              </div>
            </Field>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setComposeOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1.5 }}
                onClick={saveCompose}
              >
                Afixar no mural
              </button>
            </div>
          </Modal>
        )}
        {calendarPlayerId && (
          <PlayerCalendarModal
            player={data.players.find((player) => player.id === calendarPlayerId)}
            events={data.events}
            players={data.players}
            onClose={() => setCalendarPlayerId(null)}
            onOpenEvent={openEvent}
          />
        )}
        {pgnUpload && (
          <Modal
            title="Upload PGN"
            subtitle={data.players.find((player) => player.id === pgnUpload.playerId)?.name}
            onClose={() => setPgnUpload(null)}
            medium
          >
            <div
              style={{
                background: "#fbf6f0",
                border: "1px solid #f1ebe4",
                borderRadius: 11,
                padding: "11px 14px",
                fontSize: 12.5,
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              Carrega apenas PGNs reais dos nossos jogadores. Se o ficheiro tiver
              vários jogos, a meta informação do PGN é usada jogo a jogo; os
              campos abaixo servem como fallback.
            </div>
            <Field label="Ficheiro PGN" span>
              <input
                className="input"
                type="file"
                accept=".pgn,application/x-chess-pgn,text/plain"
                onChange={(event) =>
                  setPgnUpload((current) =>
                    current
                      ? { ...current, file: event.target.files?.[0] }
                      : current,
                  )
                }
              />
            </Field>
            <Field label="Torneio / Evento">
              <input
                className="input"
                value={pgnUpload.eventName}
                onChange={(event) =>
                  setPgnUpload({ ...pgnUpload, eventName: event.target.value })
                }
                placeholder="Ex.: Open Internacional do Porto"
              />
            </Field>
            <div className="form-grid">
              <Field label="Data">
                <input
                  className="input"
                  type="date"
                  value={pgnUpload.playedOn}
                  onChange={(event) =>
                    setPgnUpload({ ...pgnUpload, playedOn: event.target.value })
                  }
                />
              </Field>
              <Field label="Resultado">
                <select
                  className="select"
                  value={pgnUpload.result}
                  onChange={(event) =>
                    setPgnUpload({ ...pgnUpload, result: event.target.value })
                  }
                >
                  <option value="*">*</option>
                  <option value="1-0">1-0</option>
                  <option value="0-1">0-1</option>
                  <option value="1/2-1/2">1/2-1/2</option>
                </select>
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Brancas">
                <input
                  className="input"
                  value={pgnUpload.white}
                  onChange={(event) =>
                    setPgnUpload({ ...pgnUpload, white: event.target.value })
                  }
                />
              </Field>
              <Field label="Pretas">
                <input
                  className="input"
                  value={pgnUpload.black}
                  onChange={(event) =>
                    setPgnUpload({ ...pgnUpload, black: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="ECO">
              <input
                className="input"
                value={pgnUpload.eco}
                onChange={(event) =>
                  setPgnUpload({ ...pgnUpload, eco: event.target.value })
                }
                placeholder="Ex.: B90"
              />
            </Field>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setPgnUpload(null)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1.5 }}
                onClick={() => void submitPgnUpload()}
                disabled={pgnUploading}
              >
                {pgnUploading ? "A carregar…" : "Carregar PGN"}
              </button>
            </div>
          </Modal>
        )}
        {canEdit && eventModalOpen && (
          <Modal title="Novo evento" onClose={closeEventModal} medium>
            <Field label="URL do evento">
              <input
                className="input"
                value={eventForm.url}
                onChange={(e) =>
                  setEventForm((f) => ({ ...f, url: e.target.value }))
                }
                placeholder="https://chess-results.com/tnr…"
              />
              <Suspense fallback={<EventImportSkeleton />}>
                {renderEventImportBlock()}
              </Suspense>
            </Field>
            <Field label="Nome da prova" importField={importedField("name")}>
              <input
                className="input"
                value={eventForm.name}
                onChange={(e) =>
                  setEventForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Ex.: Open Internacional do Porto"
              />
            </Field>
            <div className="form-grid">
              <Field label="Local" importField={importedField("location")}>
                <input
                  className="input"
                  value={eventForm.location}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, location: e.target.value }))
                  }
                  placeholder="Cidade"
                />
              </Field>
              <Field label="Datas" importField={importedField("dates")}>
                <input
                  className="input"
                  value={eventForm.dateLabel}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, dateLabel: e.target.value }))
                  }
                  placeholder="Ex.: 20–21 JUN"
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Início" importField={importedField("dates")}>
                <input
                  className="input"
                  type="date"
                  value={eventForm.startsOn}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, startsOn: e.target.value }))
                  }
                />
              </Field>
              <Field label="Fim" importField={importedField("dates")}>
                <input
                  className="input"
                  type="date"
                  value={eventForm.endsOn}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, endsOn: e.target.value }))
                  }
                />
              </Field>
            </div>
            <Field
              label="Regulamento (URL)"
              importField={importedField("regulation")}
            >
              <input
                className="input"
                value={eventForm.regulationUrl}
                onChange={(e) =>
                  setEventForm((f) => ({ ...f, regulationUrl: e.target.value }))
                }
              />
            </Field>
            <Field label="Tipo" importField={importedField("type")}>
              <div className="chips">
                {(["standard", "blitz", "rapid"] as EventType[]).map((type) => (
                  <button
                    key={type}
                    className={`chip ${eventForm.type === type ? "active" : ""}`}
                    onClick={() => setEventForm((f) => ({ ...f, type }))}
                  >
                    {TYPE_LABEL[type]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="form-grid">
              <Field label="Época" importField={importedField("dates")}>
                <select
                  className="select"
                  value={eventForm.season}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, season: e.target.value }))
                  }
                >
                  {SEASONS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mês" importField={importedField("dates")}>
                <select
                  className="select"
                  value={eventForm.month}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, month: e.target.value }))
                  }
                >
                  {MONTHS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Estado" importField={importedField("dates")}>
                <select
                  className="select"
                  value={eventForm.status}
                  onChange={(e) =>
                    setEventForm((f) => ({
                      ...f,
                      status: e.target.value as EventStatus,
                    }))
                  }
                >
                  <option value="upcoming">Por começar</option>
                  <option value="ongoing">A decorrer</option>
                  <option value="completed">Concluído</option>
                </select>
              </Field>
              <Field
                label="Prazo de inscrição"
                importField={importedField("deadline")}
              >
                <input
                  className="input"
                  value={eventForm.deadline}
                  onChange={(e) =>
                    setEventForm((f) => ({ ...f, deadline: e.target.value }))
                  }
                  placeholder="Ex.: 17 JUN"
                />
              </Field>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={closeEventModal}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{
                  flex: 1.5,
                  opacity:
                    eventImport.status === "loading" || eventSaving ? 0.65 : 1,
                }}
                onClick={saveEvent}
                disabled={
                  eventImport.status === "loading" ||
                  eventSaving ||
                  !eventForm.name.trim()
                }
              >
                {eventImport.status === "loading"
                  ? "A importar…"
                  : eventSaving
                    ? "A guardar…"
                    : "Adicionar evento"}
              </button>
            </div>
          </Modal>
        )}
        {award && (
          <Modal
            title="Medalha extra"
            subtitle={award.playerName}
            onClose={() => setAward(null)}
            small
          >
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <button
                style={{ border: 0, background: "none", padding: 0 }}
                onClick={() =>
                  setAward((a) => {
                    if (!a) return a;
                    const type = nextPodiumMedalType(a.type);
                    return { ...a, type, label: awardLabelForType(a, type) };
                  })
                }
              >
                <MedalIcon type={award.type} size={34} />
              </button>
              <div
                style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}
              >
                <b>Clica na medalha</b> para mudar o tipo: ouro, prata ou
                bronze.
              </div>
            </div>
            <Field label="Tipo de medalha">
              <div className="chips">
                {(["gold", "silver", "bronze"] as const).map((type) => (
                  <button
                    key={type}
                    className={`chip ${award.type === type ? "active" : ""}`}
                    onClick={() =>
                      setAward(
                        (a) =>
                          a && {
                            ...a,
                            type,
                            label: awardLabelForType(a, type),
                          },
                      )
                    }
                  >
                    {type === "gold"
                      ? "Ouro"
                      : type === "silver"
                        ? "Prata"
                        : "Bronze"}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Etiqueta">
              <input
                className="input"
                value={award.label}
                onChange={(e) =>
                  setAward((a) => a && { ...a, label: e.target.value })
                }
                placeholder="Ex.: 1.º lugar"
              />
            </Field>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setAward(null)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1.3 }}
                onClick={saveAward}
              >
                Atribuir medalha
              </button>
            </div>
          </Modal>
        )}
        {edit && (
          <Modal
            title="Editar conta"
            subtitle={edit.name}
            onClose={() => setEdit(null)}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                background: "#fbe7f2",
                borderRadius: 10,
                padding: "9px 13px",
                fontSize: 12,
                color: "#8a2e66",
              }}
            >
              ✦ Só admins e moderadores podem alterar estes dados.
            </div>
            <Field label="Nome">
              <input
                className="input"
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <Field label="Email associado">
              <input
                className="input"
                value={edit.email}
                onChange={(e) => setEdit({ ...edit, email: e.target.value })}
              />
            </Field>
            <div className="form-grid">
              <Field label="ID FIDE">
                <input
                  className="input"
                  value={edit.fideId}
                  onChange={(e) => setEdit({ ...edit, fideId: e.target.value })}
                  placeholder="adicionar ID FIDE"
                />
              </Field>
              <Field label="Data de nascimento">
                <input
                  className="input"
                  type="date"
                  value={edit.dateOfBirth}
                  onChange={(e) =>
                    setEdit({ ...edit, dateOfBirth: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Telefone">
              <input
                className="input"
                value={edit.phone}
                onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                placeholder="9XX XXX XXX"
              />
            </Field>
            <div style={{ borderTop: "1px solid #f1ebe4", paddingTop: 15 }}>
              <label className="label">Nova palavra-passe</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input mono"
                  value={edit.temporaryPassword}
                  onChange={(e) =>
                    setEdit({ ...edit, temporaryPassword: e.target.value })
                  }
                  placeholder="deixar vazio para manter"
                />
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    setEdit({ ...edit, temporaryPassword: generatePassword() })
                  }
                >
                  ↻ Gerar
                </button>
              </div>
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 11.5,
                  color: "var(--soft)",
                  lineHeight: 1.5,
                }}
              >
                Define ou gera uma palavra-passe temporária e comunica-a
                manualmente.
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => setEdit(null)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1.4 }}
                onClick={saveEdit}
              >
                Guardar alterações
              </button>
            </div>
          </Modal>
        )}
        {passwordModal && (
          <Modal
            title="Palavra-passe reposta"
            subtitle={passwordModal.name}
            onClose={() => setPasswordModal(null)}
            small
          >
            <div
              className="mono"
              style={{ fontSize: 10, letterSpacing: ".12em", color: "#a89e94" }}
            >
              NOVA PALAVRA-PASSE TEMPORÁRIA
            </div>
            <div
              className="mono"
              style={{
                display: "flex",
                justifyContent: "center",
                background: "#f6f0e8",
                border: "1px dashed #d8cdbf",
                borderRadius: 12,
                padding: 16,
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              {passwordModal.value}
            </div>
            <div
              style={{
                display: "flex",
                gap: 9,
                background: "#fcefd8",
                borderRadius: 11,
                padding: "12px 14px",
              }}
            >
              <b style={{ color: "#8a6a1e" }}>!</b>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "#8a6a1e",
                }}
              >
                Comunica esta palavra-passe ao encarregado de educação. Não há
                emails automáticos de reposição.
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() =>
                  setPasswordModal({
                    ...passwordModal,
                    value: generatePassword(),
                  })
                }
              >
                Gerar outra
              </button>
              <button
                className="btn btn-ink"
                style={{ flex: 1 }}
                onClick={() => setPasswordModal(null)}
              >
                Concluir
              </button>
            </div>
          </Modal>
        )}
      </>
    );
  }

  if (screen === "login") return renderLogin();
  if (screen === "request") return renderRequest();
  return renderShell();
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
  small,
  medium,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  small?: boolean;
  medium?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal ${small ? "small" : ""} ${medium ? "medium" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="disp" style={{ fontWeight: 800, fontSize: 18 }}>
              {title}
            </div>
            {subtitle && (
              <div
                style={{
                  fontSize: 12.5,
                  color: "rgba(255,255,255,.85)",
                  marginTop: 2,
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,.18)",
              color: "#fff",
              border: 0,
              width: 30,
              height: 30,
              borderRadius: 9,
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  span,
  importField,
}: {
  label: string;
  children: React.ReactNode;
  span?: boolean;
  importField?: ChessResultsImportField;
}) {
  const className = [
    span ? "form-span" : "",
    importField ? "import-sourced-field" : "",
    importField ? `import-${importField.status}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className || undefined}>
      <label className="label field-label">
        <span>{label}</span>
        {importField && <ImportInfoIcon field={importField} />}
      </label>
      {children}
    </div>
  );
}

function EventImportSkeleton() {
  return (
    <div className="event-import-note loading">
      <div className="skeleton-line" style={{ width: "72%" }} />
      <div className="skeleton-line" style={{ width: "48%" }} />
    </div>
  );
}

function ImportInfoIcon({ field }: { field: ChessResultsImportField }) {
  return (
    <span
      className={`import-info import-${field.status}`}
      title={importFieldTooltip(field)}
    >
      i
    </span>
  );
}

function fallbackImportFieldStatus(
  imported: ChessResultsEventImport,
): Record<string, ChessResultsImportField> {
  return {
    name: {
      label: "Nome",
      status: imported.name ? "found" : "missing",
      value: imported.name,
    },
    location: {
      label: "Local",
      status: imported.location ? "found" : "missing",
      value: imported.location,
    },
    dates: {
      label: "Datas",
      status: imported.startsOn ? "found" : "missing",
      value: imported.dateLabel,
    },
    type: {
      label: "Tipo",
      status: imported.type ? "found" : "missing",
      value: imported.type,
    },
    deadline: {
      label: "Prazo",
      status: imported.deadlines.length ? "found" : "missing",
      value: imported.deadlines.at(-1)?.value,
    },
    regulation: {
      label: "Regulamento",
      status: imported.regulationUrl ? "found" : "missing",
      value: imported.regulationUrl,
    },
    initialRanking: {
      label: "Ranking inicial",
      status: imported.initialRanking.length ? "found" : "missing",
      value: `${imported.initialRanking.length} linhas`,
    },
  };
}

function importFieldTooltip(field: ChessResultsImportField) {
  const value = field.value
    ? ` Valor: ${field.label === "Tipo" ? (TYPE_LABEL[field.value as EventType] ?? field.value) : field.value}.`
    : "";
  const status =
    field.status === "found"
      ? "Obtido do Chess-Results."
      : field.status === "inferred"
        ? "Inferido a partir dos dados disponíveis no Chess-Results. Confirma antes de guardar."
        : field.status === "defaulted"
          ? "Não foi encontrado de forma explícita; foi assumido por defeito."
          : "Não encontrado nesta importação. Preenche manualmente se for obrigatório.";
  return `${field.label}: ${status}${value}${field.note ? ` ${field.note}` : ""}`;
}

async function pollChessResultsImport(
  jobId: string,
  isCancelled: () => boolean,
) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (isCancelled()) throw new Error("Importação cancelada.");
    const response = await fetch(`/api/jobs/${jobId}`);
    const payload = (await response.json().catch(() => null)) as {
      job?: { status: string; error?: string; result?: unknown };
    } | null;
    const job = payload?.job;
    if (job?.status === "succeeded") {
      if (isChessResultsImport(job.result)) return job.result;
      throw new Error("O worker terminou sem dados de evento.");
    }
    if (job?.status === "failed")
      throw new Error(job.error ?? "Importação Chess-Results falhou.");
    await sleepClient(1600);
  }
  throw new Error("A importação Chess-Results demorou demasiado tempo.");
}

async function pollWorkerJob(jobId: string, isCancelled: () => boolean) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (isCancelled()) throw new Error("Sincronização cancelada.");
    const response = await fetch(`/api/jobs/${jobId}`);
    const payload = (await response.json().catch(() => null)) as {
      job?: { status: string; error?: string };
    } | null;
    const job = payload?.job;
    if (job?.status === "succeeded") return;
    if (job?.status === "failed")
      throw new Error(job.error ?? "Sincronização Chess-Results falhou.");
    await sleepClient(1600);
  }
  throw new Error("A sincronização Chess-Results demorou demasiado tempo.");
}

function isChessResultsImport(
  value: unknown,
): value is ChessResultsEventImport {
  return Boolean(
    value &&
    typeof value === "object" &&
    "sourceUrl" in value &&
    "initialRanking" in value,
  );
}

function applyImportToEventForm(
  form: EventForm,
  imported: ChessResultsEventImport,
): EventForm {
  return {
    ...form,
    name: imported.name ?? form.name,
    location: imported.location ?? form.location,
    dateLabel: imported.dateLabel ?? form.dateLabel,
    startsOn: imported.startsOn ?? form.startsOn,
    endsOn: imported.endsOn ?? imported.startsOn ?? form.endsOn,
    regulationUrl: imported.regulationUrl ?? form.regulationUrl,
    type: imported.type ?? form.type,
    status: imported.status ?? form.status,
    season: imported.season ?? form.season,
    month: imported.month ?? form.month,
    deadline: imported.deadlines.at(-1)?.value ?? form.deadline,
  };
}

function sleepClient(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function BirthDateInput({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: boolean;
  onChange: (value: string) => void;
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const normalized = normalizeBirthDate(value);

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker) return;
    try {
      picker.showPicker?.();
    } catch {
      picker.focus();
    }
  }

  return (
    <div>
      <div style={{ position: "relative" }}>
        <input
          className="input"
          value={birthDateDisplayValue(value)}
          onClick={openPicker}
          onChange={(event) =>
            onChange(formatBirthDateInput(event.target.value))
          }
          aria-invalid={Boolean(error)}
          inputMode="numeric"
          placeholder="DD/MM/AAAA — dia/mês/ano"
          style={{ paddingRight: 46 }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 14,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#8a8178",
            pointerEvents: "none",
          }}
        >
          📅
        </span>
        <input
          ref={pickerRef}
          type="date"
          lang="pt-PT"
          aria-label="Abrir calendário para data de nascimento"
          value={normalized ?? ""}
          max={todayIsoDate()}
          onChange={(event) => onChange(formatIsoBirthDate(event.target.value))}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 44,
            height: "100%",
            opacity: 0,
            cursor: "pointer",
          }}
        />
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11.5,
          color: error ? "var(--red)" : "var(--muted)",
          lineHeight: 1.35,
        }}
      >
        {birthDateHelp(value)}
      </div>
    </div>
  );
}

function BrandMark({ white }: { white?: boolean }) {
  return (
    <svg className="brand-mark" viewBox="0 0 60 56" aria-hidden>
      <circle
        cx="19"
        cy="37"
        r="16"
        fill={white ? "#fff" : "var(--pink)"}
        opacity={white ? 0.9 : 1}
      />
      <circle cx="41" cy="19" r="17" fill={white ? "#fff" : "var(--red)"} />
    </svg>
  );
}

function MarkdownText({ text }: { text: string }) {
  const openedAt = useRef(0);

  function openLink(event: React.SyntheticEvent<HTMLElement>) {
    const link = (event.target as HTMLElement).closest(
      "a[href]",
    ) as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (now - openedAt.current < 500) return;
    openedAt.current = now;
    window.open(link.href, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      style={{ fontSize: 13, lineHeight: 1.55, color: "#2a2620" }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("a[href]")) {
          event.stopPropagation();
        }
      }}
      onPointerUp={openLink}
      onClick={openLink}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }}
    />
  );
}

function markdownToHtml(text: string) {
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html += '<ul style="margin:4px 0;padding-left:18px">';
        inList = true;
      }
      html += `<li>${markdownInline(line.replace(/^[-*]\s+/, ""))}</li>`;
      continue;
    }
    closeList();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const size =
        heading[1].length === 1 ? 16 : heading[1].length === 2 ? 15 : 14;
      html += `<div style="font-weight:800;font-size:${size}px;margin:3px 0">${markdownInline(heading[2])}</div>`;
    } else if (!line.trim()) {
      html += '<div style="height:5px"></div>';
    } else {
      html += `<div>${markdownInline(line)}</div>`;
    }
  }
  closeList();
  return html;
}

function markdownInline(input: string) {
  return escapeHtml(input)
    .replace(
      /\[([^\]]+)]\((https?:[^)\s]+)\)/g,
      '<a data-no-drag href="$2" target="_blank" rel="noreferrer" style="color:#8A2E66;font-weight:700;text-decoration:underline">$1</a>',
    )
    .replace(
      /`([^`]+)`/g,
      '<code style="font-family:Space Mono,monospace;font-size:12px;background:rgba(0,0,0,.07);padding:1px 4px;border-radius:4px">$1</code>',
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        className="mono"
        style={{ fontSize: 10, letterSpacing: ".1em", color: "#a89e94" }}
      >
        {label}
      </span>
      <select
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: "auto", minWidth: 130 }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function TypeBadge({ type, short }: { type: EventType; short?: boolean }) {
  return (
    <span className={`badge badge-${type}`}>
      {short ? TYPE_SHORT[type] : TYPE_LABEL[type]}
    </span>
  );
}

function StatusBadge({ event }: { event: EventRecord }) {
  const color =
    event.status === "ongoing"
      ? "#2f9e54"
      : event.status === "completed"
        ? "#7e9b6a"
        : event.status === "registration_open"
          ? "var(--pink)"
          : "#a89e94";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 800,
        color,
      }}
    >
      {event.status === "ongoing" && <span className="live-dot" />}
      {STATUS_LABEL[event.status]}
    </span>
  );
}

function RegistrationPill({
  status,
}: {
  status: EventRegistrationRecord["status"];
}) {
  const confirmed = status === "confirmed";
  return (
    <span
      className="mono"
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        padding: "2px 6px",
        borderRadius: 999,
        background: confirmed ? "#dff2e7" : "#f6f0e8",
        color: confirmed ? "#2f7a4c" : "#8a8178",
      }}
    >
      {REGISTRATION_STATUS_LABEL[status]}
    </span>
  );
}

function SyncPill({
  tone,
  children,
}: {
  tone: "green" | "amber";
  children: React.ReactNode;
}) {
  const green = tone === "green";
  return (
    <span
      className="mono"
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        padding: "2px 6px",
        borderRadius: 999,
        background: green ? "#dff2e7" : "#fcefd8",
        color: green ? "#2f7a4c" : "#8a6a1e",
      }}
    >
      {children}
    </span>
  );
}

function EventMedalSummary({ medals }: { medals: Medal[] }) {
  const counts = (["gold", "silver", "bronze"] as MedalType[])
    .map((type) => ({ type, count: countMedalsList(medals, type) }))
    .filter((entry) => entry.count > 0);
  if (!counts.length) return null;

  return (
    <span
      className="event-medal-summary"
      title={medalSummaryTitle(counts)}
      aria-label={medalSummaryTitle(counts)}
    >
      {counts.map(({ type, count }) => (
        <span key={type} className="event-medal-count">
          <MedalIcon type={type} size={16} />
          <span>{count}</span>
        </span>
      ))}
    </span>
  );
}

function InfoCard({
  label,
  value,
  note,
  pink,
  status,
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  pink?: boolean;
  status?: boolean;
}) {
  return (
    <div className="panel" style={{ padding: "15px 16px" }}>
      <div
        className="mono"
        style={{ fontSize: 9, letterSpacing: ".12em", color: "#a89e94" }}
      >
        {label}
      </div>
      <div
        className="disp"
        style={{
          fontWeight: 800,
          fontSize: pink ? 20 : 16,
          marginTop: 5,
          color: pink ? "var(--pink)" : status ? "#2f9e54" : "var(--text)",
        }}
      >
        {value}
      </div>
      {note && (
        <div style={{ fontSize: 12, color: "var(--soft)", marginTop: 1 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function InfoMini({
  label,
  value,
  pink,
}: {
  label: string;
  value: string;
  pink?: boolean;
}) {
  return (
    <div>
      <div
        className="mono"
        style={{ fontSize: 9.5, letterSpacing: ".1em", color: "#a89e94" }}
      >
        {label}
      </div>
      <div
        className="disp"
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: pink ? "var(--pink)" : "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DocLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textDecoration: "none",
        padding: "11px 14px",
        background: "#f6f0e8",
        borderRadius: 10,
        marginBottom: 9,
      }}
    >
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
      <span style={{ color: "#a89e94" }}>↗</span>
    </a>
  );
}

function FideProfileLink({ fideId }: { fideId?: string }) {
  if (!fideId) return null;
  return (
    <a
      className="mono"
      href={fideProfileUrl(fideId)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      style={{
        fontSize: 10.5,
        color: "var(--pink)",
        fontWeight: 800,
        textDecoration: "none",
      }}
    >
      FIDE {fideId} ↗
    </a>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 46, marginBottom: 8, opacity: 0.5 }}>♟</div>
      <div className="disp" style={{ fontSize: 19, fontWeight: 800 }}>
        {title}
      </div>
      <p
        style={{
          color: "var(--soft)",
          fontSize: 14,
          margin: "8px auto 0",
          maxWidth: 420,
          lineHeight: 1.5,
        }}
      >
        {body}
      </p>
    </div>
  );
}

function MedalIcon({
  type,
  size,
  label,
}: {
  type: MedalType;
  size: number;
  label?: React.ReactNode;
}) {
  const cls = `medal-${type}`;
  return (
    <span
      className={`medal ${cls}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.floor(size / 2.5)),
      }}
    >
      {label}
    </span>
  );
}

function MedalCount({
  type,
  count,
}: {
  type: "gold" | "silver" | "bronze";
  count: number;
}) {
  return <MedalIcon type={type} size={22} label={count} />;
}

function RatingCell({ value, delta }: { value: number; delta?: number }) {
  if (!value)
    return (
      <span className="mono" style={{ textAlign: "right", color: "#a89e94" }}>
        —
      </span>
    );
  const changed = Boolean(delta);
  return (
    <span style={{ textAlign: "right" }} title="Variação face ao mês anterior">
      <span className="mono" style={{ fontWeight: 700 }}>
        {value}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 10,
          marginLeft: 4,
          color: !changed ? "#a89e94" : delta! > 0 ? "#3e7d3a" : "var(--red)",
        }}
      >
        {!changed ? "–" : delta! > 0 ? `▲${delta}` : `▼${Math.abs(delta!)}`}
      </span>
    </span>
  );
}

function RankTrend({
  delta,
  scope,
}: {
  delta?: number;
  scope: "ranking absoluto" | "escalão";
}) {
  const changed = Boolean(delta);
  return (
    <span
      className="mono"
      title={`Posições ganhas/perdidas desde o mês anterior no ${scope}`}
      style={{
        flex: "0 0 auto",
        fontSize: 10.5,
        fontWeight: 800,
        color: !changed ? "#a89e94" : delta! > 0 ? "#3e7d3a" : "var(--red)",
      }}
    >
      {!changed ? "–" : delta! > 0 ? `▲${delta}` : `▼${Math.abs(delta!)}`}
    </span>
  );
}

function RatingDeltaBadge({ delta }: { delta?: number }) {
  const changed = Boolean(delta);
  return (
    <span
      className="mono"
      style={{
        fontSize: 12,
        color: !changed ? "#a89e94" : delta! > 0 ? "#3e7d3a" : "var(--red)",
        fontWeight: 800,
      }}
    >
      {!changed ? "–" : delta! > 0 ? `▲${delta}` : `▼${Math.abs(delta!)}`}
    </span>
  );
}

function PlayerCalendarModal({
  player,
  events,
  players,
  onClose,
  onOpenEvent,
}: {
  player?: Player;
  events: EventRecord[];
  players: Player[];
  onClose: () => void;
  onOpenEvent: (eventId: string) => void;
}) {
  if (!player) return null;
  const upcoming = upcomingEventsForPlayer(player, events, players);
  const deadlines = recommendedDeadlinesForPlayer(player, events).slice(0, 8);
  return (
    <Modal title="Calendário do atleta" subtitle={player.name} onClose={onClose} medium>
      <div>
        <h3 className="disp" style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800 }}>
          Próximos torneios inscritos
        </h3>
        {upcoming.length ? (
          upcoming.map((event) => (
            <button
              key={event.id}
              onClick={() => {
                onClose();
                onOpenEvent(event.id);
              }}
              style={{
                width: "100%",
                border: "1px solid #f1ebe4",
                borderRadius: 12,
                background: "#fff",
                padding: "12px 14px",
                textAlign: "left",
                cursor: "pointer",
                marginBottom: 9,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <b style={{ fontSize: 13.5 }}>{event.name}</b>
                <StatusBadge event={event} />
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {event.dateLabel} · {event.location} · {TYPE_LABEL[event.type]}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "#a89e94", marginTop: 4 }}>
                {event.participantsLabel}
                {event.chessResultsUrl ? " · Chess-Results disponível" : ""}
              </div>
            </button>
          ))
        ) : (
          <p style={{ margin: 0, color: "var(--soft)", fontSize: 13 }}>
            Não há torneios futuros com inscrição registada.
          </p>
        )}
      </div>
      <div style={{ borderTop: "1px solid #f1ebe4", paddingTop: 16 }}>
        <h3 className="disp" style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800 }}>
          Prazos de torneios recomendados
        </h3>
        {deadlines.length ? (
          deadlines.map(({ event, deadline }) => (
            <button
              key={`${event.id}:${deadline.label}:${deadline.value}`}
              onClick={() => {
                onClose();
                onOpenEvent(event.id);
              }}
              style={{
                width: "100%",
                border: 0,
                borderRadius: 11,
                background: "#fbf6f0",
                padding: "10px 12px",
                textAlign: "left",
                cursor: "pointer",
                marginBottom: 8,
              }}
            >
              <b style={{ fontSize: 13 }}>{event.name}</b>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                {deadline.label}: {deadline.value}
                {deadline.date ? ` · ${formatShortDate(deadline.date)}` : ""}
              </div>
            </button>
          ))
        ) : (
          <p style={{ margin: 0, color: "var(--soft)", fontSize: 13 }}>
            Sem prazos recomendados pendentes para este atleta.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: "var(--muted)",
      }}
    >
      <span
        style={{ width: 18, height: 3, background: color, borderRadius: 2 }}
      />
      {label}
    </span>
  );
}

function ratingSeries(
  player: Player,
  type: RatingType,
  color: string,
  months: string[],
) {
  return {
    color,
    points: months
      .map((month, index) => ({
        index,
        value: ratingAtOrBefore(player, month, type, 0),
      }))
      .filter((point) => point.value > 0),
  };
}

function shouldShowChartMonthLabel(index: number, total: number) {
  if (total <= 8) return true;
  return (
    index === 0 || index === total - 1 || index % Math.ceil(total / 6) === 0
  );
}

function formatFideShortMonthLabel(month: string) {
  const year = month.slice(2, 4);
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const label = FIDE_SHORT_MONTH_LABELS[monthIndex];
  return label && /^\d{2}$/.test(year) ? `${label} ${year}` : month.slice(0, 7);
}

function RatingChart({ player }: { player: Player }) {
  const W = 720,
    H = 240,
    pad = 34,
    padL = 46;
  const months = (player.ratingHistory ?? [])
    .map((point) => point.listMonth)
    .slice(-18);
  const chartMonths = months.length
    ? months
    : [new Date().toISOString().slice(0, 7) + "-01"];
  const histories = [
    ratingSeries(player, "standard", "var(--ink)", chartMonths),
    ratingSeries(player, "rapid", "var(--pink)", chartMonths),
    ratingSeries(player, "blitz", "var(--red)", chartMonths),
  ].filter((series) => series.points.length > 0);
  const all = histories.flatMap((series) =>
    series.points.map((point) => point.value),
  );
  if (!all.length) return null;
  const min = Math.min(...all, 1000) - 15;
  const max = Math.max(...all, 2400) + 15;
  const x = (i: number) =>
    chartMonths.length === 1
      ? (W + padL - pad) / 2
      : padL + i * ((W - padL - pad) / (chartMonths.length - 1));
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {[0, 1, 2, 3].map((g) => {
        const gv = min + ((max - min) * g) / 3;
        return (
          <g key={g}>
            <line
              x1={padL}
              x2={W - pad}
              y1={y(gv)}
              y2={y(gv)}
              stroke="#F1EBE4"
            />
            <text
              x={padL - 8}
              y={y(gv) + 4}
              textAnchor="end"
              fontSize="11"
              fontFamily="Space Mono"
              fill="#A89E94"
            >
              {Math.round(gv)}
            </text>
          </g>
        );
      })}
      {chartMonths.map((month, index) =>
        shouldShowChartMonthLabel(index, chartMonths.length) ? (
          <text
            key={month}
            x={x(index)}
            y={H - 10}
            textAnchor="middle"
            fontSize="10"
            fontFamily="Space Mono"
            fill="#A89E94"
          >
            {formatFideShortMonthLabel(month)}
          </text>
        ) : null,
      )}
      {histories.map((series) => (
        <g key={series.color}>
          <polyline
            points={series.points
              .map((point) => `${x(point.index)},${y(point.value)}`)
              .join(" ")}
            fill="none"
            stroke={series.color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {series.points.at(-1) && (
            <circle
              cx={x(series.points.at(-1)!.index)}
              cy={y(series.points.at(-1)!.value)}
              r="4"
              fill={series.color}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

function activeNav(view: View) {
  if (view === "evento") return "eventos";
  if (view === "jogador" || view === "partida") return "fide";
  return view;
}

type ParsedAppRoute = {
  screen?: Screen;
  view: View;
  eventId?: string;
  playerId?: string;
  gameId?: string;
  manageOpen?: boolean;
  eventModal?: boolean;
};

function routeFromPath(pathname: string, data: AppData): ParsedAppRoute {
  const segments = pathname.split("/").filter(Boolean).map(decodePathSegment);
  const [section, id, subroute] = segments;

  if (!section) return { view: "mural" };
  if (section === "login") return { screen: "login", view: "mural" };
  if (section === "pedir-acesso") return { screen: "request", view: "mural" };
  if (section === "mural") return { view: "mural" };
  if (section === "eventos") {
    if (id === "novo") return { view: "eventos", eventModal: true };
    if (id)
      return {
        view: "evento",
        eventId: resolveEventId(id, data),
        manageOpen: subroute === "inscricoes",
      };
    return { view: "eventos" };
  }
  if (section === "fide") return { view: "fide" };
  if (section === "jogadores")
    return { view: "jogador", playerId: resolvePlayerId(id, data) };
  if (section === "partidas")
    return { view: "partida", gameId: resolveGameId(id, data) };
  if (section === "trofeus") return { view: "trofeus" };
  if (section === "gestao") return { view: "gestao" };

  return { view: "mural" };
}

function pathForView(
  view: View,
  selection: { eventId?: string; playerId?: string; gameId?: string },
  data: AppData,
) {
  if (view === "mural") return "/mural";
  if (view === "eventos") return "/eventos";
  if (view === "evento")
    return selection.eventId ? eventRoute(selection.eventId, data) : "/eventos";
  if (view === "fide") return "/fide";
  if (view === "jogador")
    return selection.playerId ? playerRoute(selection.playerId, data) : "/fide";
  if (view === "partida")
    return selection.gameId ? gameRoute(selection.gameId) : "/fide";
  if (view === "trofeus") return "/trofeus";
  return "/gestao";
}

function eventRoute(id: string, data: Pick<AppData, "events">) {
  const event = data.events.find((candidate) => candidate.id === id);
  return event
    ? `/eventos/${encodeURIComponent(id)}/${slugify(event.name)}`
    : `/eventos/${encodeURIComponent(id)}`;
}

function eventRegistrationsRoute(id: string) {
  return `/eventos/${encodeURIComponent(id)}/inscricoes`;
}

function playerRoute(id: string, data: Pick<AppData, "players">) {
  const player = data.players.find((candidate) => candidate.id === id);
  return player
    ? `/jogadores/${encodeURIComponent(id)}/${slugify(player.name)}`
    : `/jogadores/${encodeURIComponent(id)}`;
}

function gameRoute(id: string) {
  return `/partidas/${encodeURIComponent(id)}`;
}

function isAuthPath(pathname: string) {
  return pathname === "/login" || pathname === "/pedir-acesso";
}

function resolveEventId(
  value: string | undefined,
  data: Pick<AppData, "events">,
) {
  if (!value) return data.events[0]?.id;
  return (
    data.events.find(
      (event) => event.id === value || slugify(event.name) === value,
    )?.id ?? data.events[0]?.id
  );
}

function resolvePlayerId(
  value: string | undefined,
  data: Pick<AppData, "players">,
) {
  if (!value) return data.players[0]?.id;
  return (
    data.players.find(
      (player) => player.id === value || slugify(player.name) === value,
    )?.id ?? data.players[0]?.id
  );
}

function resolveGameId(
  value: string | undefined,
  data: Pick<AppData, "games">,
) {
  if (!value) return data.games[0]?.id;
  return data.games.find((game) => game.id === value)?.id ?? data.games[0]?.id;
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

function roleLabel(role: Role) {
  return role === "admin"
    ? "Admin"
    : role === "moderator"
      ? "Moderador"
      : "Aluno";
}

function findAccountPlayerId(account: Account | null, players: Player[]) {
  if (!account) return null;
  return (
    players.find(
      (player) =>
        (account.fideId &&
          normalizeFideId(player.fideId) === normalizeFideId(account.fideId)) ||
        normalizePersonName(player.name) === normalizePersonName(account.name),
    )?.id ?? null
  );
}

function fideProfileUrl(fideId: string) {
  return `https://ratings.fide.com/profile/${encodeURIComponent(fideId)}`;
}

function relativeDateLabel(value: string) {
  const date = parseIsoDate(value);
  const today = parseIsoDate(todayIsoDate());
  if (!date || !today) return value;

  const diffDays = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays < 0) return formatShortDate(value);
  if (diffDays === 0) return "hoje";
  if (diffDays === 1) return "há 1 dia";
  if (diffDays < 7) return `há ${diffDays} dias`;
  if (diffDays < 14) return "há 1 semana";
  if (diffDays < 31) return `há ${Math.floor(diffDays / 7)} semanas`;
  if (diffDays < 62) return "há 1 mês";
  if (diffDays < 365) return `há ${Math.floor(diffDays / 30)} meses`;
  if (diffDays < 730) return "há 1 ano";
  return `há ${Math.floor(diffDays / 365)} anos`;
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

function formatShortDate(value: string) {
  const date = parseIsoDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("pt-PT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function birthDateDisplayValue(value: string) {
  const normalized = normalizeBirthDate(value);
  if (normalized && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return formatIsoBirthDate(normalized);
  }
  return formatBirthDateInput(value);
}

function formatBirthDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function formatIsoBirthDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function birthDateHelp(value: string) {
  const display = birthDateDisplayValue(value);
  const normalized = normalizeBirthDate(display);
  const digits = display.replace(/\D/g, "");
  if (normalized) {
    return "";
  }
  if (!digits) {
    return "";
  }
  if (digits.length < 8) {
    return "A escrever em dia/mês/ano (DD/MM/AAAA).";
  }
  return "Data inválida. Confirma o dia, o mês e o ano.";
}

function formatBirthDateLong(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-PT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function validateRequestForm(
  form: RequestForm,
  consent: boolean,
): { ok: true; value: RequestForm } | { ok: false; error: string } {
  const studentName = form.studentName.trim();
  const dateOfBirth = normalizeBirthDate(form.dateOfBirth);
  const fideId = form.fideId.trim();
  const guardianEmail = form.guardianEmail.trim().toLowerCase();
  const phone = form.phone.trim();
  const password = form.password;
  const confirmPassword = form.confirmPassword;

  if (!studentName) return { ok: false, error: "Indica o nome do aluno." };
  if (!dateOfBirth) {
    return { ok: false, error: "Indica uma data de nascimento válida." };
  }
  if (!guardianEmail || !/^\S+@\S+\.\S+$/.test(guardianEmail)) {
    return { ok: false, error: "Indica um email válido." };
  }
  if (password.length < 8) {
    return {
      ok: false,
      error: "A palavra-passe tem de ter pelo menos 8 caracteres.",
    };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: "As palavras-passe não coincidem." };
  }
  if (!consent) {
    return { ok: false, error: "Confirma a autorização para continuar." };
  }

  return {
    ok: true,
    value: {
      ...form,
      studentName,
      dateOfBirth,
      fideId,
      guardianEmail,
      phone,
      password,
      confirmPassword,
      message: form.message.trim(),
    },
  };
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
function kmLabel(km: number) {
  if (!Number.isFinite(km) || km <= 0) return "distância a confirmar";
  return km >= 1000 ? `${Math.round(km / 100) / 10} mil km` : `${km} km`;
}

function distanceNote(km: number) {
  return km > 0 ? `${kmLabel(km)} do Colégio Efanor` : kmLabel(km);
}
function eventSortValue(event: EventRecord) {
  const order = MONTHS.indexOf(event.month);
  return (
    (event.season === "2026/27" ? -1 : 1) * (order >= 0 ? order : 0) +
    Number(event.id.replace(/\D/g, "") || 0)
  );
}
function computeMissingFields(input: {
  fideId?: string;
  dateOfBirth?: string;
  phone?: string;
}) {
  const fields = [];
  if (!input.fideId) fields.push("ID FIDE");
  if (!input.dateOfBirth) fields.push("data de nascimento");
  if (!input.phone) fields.push("telefone");
  return fields;
}
function generatePassword() {
  const words = [
    "Cavalo",
    "Torre",
    "Bispo",
    "Dama",
    "Roque",
    "Gambito",
    "Xeque",
    "Escaque",
  ];
  return `${words[Math.floor(Math.random() * words.length)]}-${100 + Math.floor(Math.random() * 900)}`;
}
function countMedals(medals: Medal[], playerId: string, type: MedalType) {
  return medals.filter(
    (medal) => medal.playerId === playerId && medal.type === type,
  ).length;
}
function countMedalsList(medals: Medal[], type: MedalType) {
  return medals.filter((medal) => medal.type === type).length;
}
function nextPodiumMedalType(
  type: Extract<MedalType, "gold" | "silver" | "bronze">,
) {
  return type === "gold" ? "silver" : type === "silver" ? "bronze" : "gold";
}

function podiumMedalLabel(
  type: Extract<MedalType, "gold" | "silver" | "bronze">,
) {
  return type === "gold"
    ? "1.º lugar"
    : type === "silver"
      ? "2.º lugar"
      : "3.º lugar";
}

function awardLabelForType(
  award: NonNullable<AwardState>,
  type: Extract<MedalType, "gold" | "silver" | "bronze">,
) {
  return award.teamName
    ? teamMedalLabel(type, award.teamName)
    : podiumMedalLabel(type);
}

function teamMedalLabel(
  type: Extract<MedalType, "gold" | "silver" | "bronze">,
  teamName: string,
) {
  return `${type === "gold" ? "Ouro" : type === "silver" ? "Prata" : "Bronze"} por equipas · ${teamName}`;
}

function teamMedalTypeForPosition(
  position?: number,
): Extract<MedalType, "gold" | "silver" | "bronze"> | undefined {
  return position === 1
    ? "gold"
    : position === 2
      ? "silver"
      : position === 3
        ? "bronze"
        : undefined;
}

function medalLabel(medal: Medal) {
  return medal.type === "gold"
    ? "1.º lugar"
    : medal.type === "silver"
      ? "2.º lugar"
      : "3.º lugar";
}

function medalSummaryTitle(counts: Array<{ type: MedalType; count: number }>) {
  return counts
    .map(({ type, count }) => `${count} ${medalTypeName(type, count)}`)
    .join(" · ");
}

function medalTypeName(type: MedalType, count: number) {
  const plural = count !== 1;
  if (type === "gold") return plural ? "ouros" : "ouro";
  if (type === "silver") return plural ? "pratas" : "prata";
  return plural ? "bronzes" : "bronze";
}
function buildMedalMap(medals: Medal[]) {
  return medals.reduce<Record<string, Medal[]>>((acc, medal) => {
    acc[medal.playerId] = [...(acc[medal.playerId] ?? []), medal];
    return acc;
  }, {});
}

function isEventSyncInFlight(syncState?: EventSyncState) {
  return (
    syncState?.status === "syncing" ||
    (syncState?.status === "debounced" && Boolean(syncState.jobId))
  );
}

function toggleStatusFilter(
  current: StatusFilter[],
  next: StatusFilter,
): StatusFilter[] {
  if (next === "all") return ["all"];
  const base = current.includes("all") ? [] : current;
  const updated = base.includes(next)
    ? base.filter((status) => status !== next)
    : [...base, next];
  return updated.length ? updated : ["all"];
}

type EventRegistrationSyncState = {
  detailsByPlayerId: Map<string, EventRegistrationRecord>;
  registeredPlayers: Player[];
  importedMatchedPlayers: Player[];
  importedClubCount: number;
  confirmedCount: number;
  hasChessResultsStartList: boolean;
  chessResultsPlayerIds: Set<string>;
  importedUnregisteredMatches: Array<{
    row: EventStartListEntry;
    player: Player;
  }>;
  unassociatedClubEntries: EventStartListEntry[];
  missingFromChessResults: Player[];
};

function buildRegistrationSyncState(
  event: EventRecord,
  players: Player[],
): EventRegistrationSyncState {
  const detailsByPlayerId = new Map<string, EventRegistrationRecord>(
    event.registrations.map((playerId) => [
      playerId,
      { playerId, status: "selected" },
    ]),
  );
  for (const registration of event.registrationDetails ?? [])
    detailsByPlayerId.set(registration.playerId, registration);
  const registeredPlayerIds = new Set(event.registrations);
  const registeredPlayers = event.registrations
    .map((id) => players.find((player) => player.id === id))
    .filter(Boolean) as Player[];
  const hasChessResultsStartList = Boolean(event.initialRanking?.length);
  const chessResultsPlayerIds = new Set<string>();
  const importedUnregisteredMatches: Array<{
    row: EventStartListEntry;
    player: Player;
  }> = [];
  const unassociatedClubEntries: EventStartListEntry[] = [];
  const importedMatchedPlayers: Player[] = [];
  const importedMatchedIds = new Set<string>();

  for (const row of event.initialRanking ?? []) {
    const player = findTournamentPlayer(players, row);
    if (player) {
      chessResultsPlayerIds.add(player.id);
      if (!importedMatchedIds.has(player.id)) {
        importedMatchedIds.add(player.id);
        importedMatchedPlayers.push(player);
      }
      if (!registeredPlayerIds.has(player.id))
        importedUnregisteredMatches.push({ row, player });
    } else if (isEfanorClub(row.club)) {
      unassociatedClubEntries.push(row);
    }
  }

  const missingFromChessResults = hasChessResultsStartList
    ? registeredPlayers.filter(
        (player) => !chessResultsPlayerIds.has(player.id),
      )
    : [];
  const confirmedCount = registeredPlayers.filter(
    (player) =>
      detailsByPlayerId.get(player.id)?.status === "confirmed" ||
      chessResultsPlayerIds.has(player.id),
  ).length;

  return {
    detailsByPlayerId,
    registeredPlayers,
    importedMatchedPlayers,
    importedClubCount:
      importedMatchedPlayers.length + unassociatedClubEntries.length,
    confirmedCount,
    hasChessResultsStartList,
    chessResultsPlayerIds,
    importedUnregisteredMatches,
    unassociatedClubEntries,
    missingFromChessResults,
  };
}

function upsertRegistrationDetail(
  details: EventRegistrationRecord[],
  next: EventRegistrationRecord,
) {
  const exists = details.some(
    (registration) => registration.playerId === next.playerId,
  );
  return exists
    ? details.map((registration) =>
        registration.playerId === next.playerId ? next : registration,
      )
    : [...details, next];
}

function isTeamEventRecord(event: EventRecord) {
  return (
    event.format === "team" ||
    Boolean(event.teamStandings?.length || event.teamMembers?.length) ||
    /\bteam\b|equipas?/i.test(event.name)
  );
}

function teamCountForEvent(event: EventRecord) {
  return (
    buildTeamStandingRows(event).length ||
    uniqueStrings(event.teamMembers?.map((member) => member.teamName) ?? [])
      .length
  );
}

function buildTeamStandingRows(event: EventRecord): EventTeamStanding[] {
  const explicit = event.teamStandings ?? [];
  if (explicit.length)
    return explicit.slice().sort((a, b) => a.position - b.position);
  const liveTeamRows =
    event.live?.standings
      .filter((standing) => standing.team)
      .map(
        (standing): EventTeamStanding => ({
          position: standing.position,
          seed: standing.seed,
          name: standing.name,
          played: standing.played,
          wins: standing.wins,
          draws: standing.draws,
          losses: standing.losses,
          matchPoints: standing.matchPoints ?? standing.points,
          boardPoints: standing.boardPoints,
          tieBreaks: standing.tieBreaks,
        }),
      ) ?? [];
  return liveTeamRows.sort((a, b) => a.position - b.position);
}

function teamHasClubPlayer(
  teamName: string,
  members: EventTeamMember[],
  players: Player[],
) {
  return members.some(
    (member) =>
      sameTeamName(member.teamName, teamName) &&
      findTeamMemberPlayer(member, players),
  );
}

function findTeamMemberPlayer(member: EventTeamMember, players: Player[]) {
  const fideId = normalizeFideId(member.fideId);
  if (fideId) {
    const byFideId = players.find(
      (player) => normalizeFideId(player.fideId) === fideId,
    );
    if (byFideId) return byFideId;
  }
  const normalized = normalizePersonName(member.name);
  const exact = players.filter(
    (player) => normalizePersonName(player.name) === normalized,
  );
  return exact.length === 1 ? exact[0] : undefined;
}

function sameTeamName(a?: string, b?: string) {
  return normalizeTeamName(a ?? "") === normalizeTeamName(b ?? "");
}

function normalizeTeamName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

type FinalRow = {
  pos: number;
  name: string;
  club: string;
  points: string;
  fideId?: string;
  us: boolean;
  delta?: string;
};

function buildFinalRows(event: EventRecord, players: Player[]): FinalRow[] {
  if (
    !event.result &&
    event.live?.standings.length &&
    event.live.standings[0]?.position === 1
  ) {
    return event.live.standings.map((standing) => {
      const player = findTournamentPlayer(
        players,
        standing,
        event.initialRanking,
      );
      return {
        pos: standing.position,
        name: standing.name,
        club: standing.club,
        points: standing.points,
        fideId: standing.fideId,
        us: standing.us || Boolean(player) || isEfanorClub(standing.club),
      };
    });
  }
  if (!event.result) return [];
  const rows: FinalRow[] = event.result.athletes
    .filter((athlete) => !/Equipa/i.test(athlete.name))
    .map((athlete, index) => ({
      pos: index + 1 + (event.result?.leadExternalPlayers ?? 0),
      name: athlete.name,
      club: "Efanor",
      points: athlete.score,
      delta: athlete.delta,
      us: true,
    }));
  const external: FinalRow[] = [
    "A. Ferreira",
    "R. Costa",
    "M. Sousa",
    "J. Pereira",
    "N. Lopes",
    "D. Carvalho",
    "P. Antunes",
    "L. Faria",
  ]
    .slice(0, event.result.leadExternalPlayers ?? 0)
    .map((name, index) => ({
      pos: index + 1,
      name,
      club: ["GX Porto", "AX Gaia", "CX Famalicão"][index % 3],
      points: `${Math.max(5, 8 - index / 2)}/9`,
      us: false,
    }));
  const filler: FinalRow[] = players
    .slice(0, Math.max(0, 10 - rows.length - external.length))
    .filter((player) => !rows.some((row) => row.name === player.name))
    .map((player, index) => ({
      pos: rows.length + external.length + index + 1,
      name: player.name,
      club: "Efanor",
      points: `${Math.max(3, 5 - index / 2)}/9`,
      us: true,
    }));
  return [...external, ...rows, ...filler]
    .sort((a, b) => a.pos - b.pos)
    .map((row, index) => ({ ...row, pos: index + 1 }));
}

function ratingMonthOptions(players: Player[]) {
  const months = new Set<string>();
  for (const player of players) {
    for (const point of player.ratingHistory ?? []) months.add(point.listMonth);
  }
  return [...months].sort().map((month) => ({
    month,
    label: fideMonthLabel(month),
  }));
}

function fideMonthLabel(month: string) {
  const year = month.slice(0, 4);
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const label = FIDE_MONTH_LABELS[monthIndex];
  return label && /^\d{4}$/.test(year) ? `${label} ${year}` : month;
}

function workerTypeLabel(type: string) {
  const labels: Record<string, string> = {
    "fide.importMonthly": "Importação mensal FIDE",
    "chessResults.importEvent": "Importação de evento Chess-Results",
    "chessResults.syncEvent": "Sincronização Chess-Results",
    "events.lifecycle": "Atualização de estados dos eventos",
    "medals.recompute": "Recalcular medalhas",
    "backups.nightly": "Backup da base de dados",
  };
  return labels[type] ?? type;
}

function workerStatusLabel(status: WorkerRun["status"]) {
  if (status === "succeeded") return "Concluído";
  if (status === "running") return "A executar";
  if (status === "queued") return "Em fila";
  return "Falhou";
}

function workerStatusStyle(status: WorkerRun["status"]) {
  return {
    background:
      status === "succeeded"
        ? "#e6f4ec"
        : status === "running"
          ? "#fbe7f2"
          : status === "failed"
            ? "#fbd3ce"
            : "#fcebc4",
    color:
      status === "succeeded"
        ? "#2f7a4c"
        : status === "running"
          ? "var(--pink)"
          : status === "failed"
            ? "var(--red)"
            : "#9a7a2e",
  };
}

function workerSummary(run: WorkerRun) {
  if (run.message) return run.message;
  if (run.type === "backups.nightly" && run.result && typeof run.result === "object") {
    const result = run.result as { fileName?: string; bytes?: number };
    return result.fileName
      ? `${result.fileName}${result.bytes ? ` · ${Math.round(result.bytes / 1024)} KB` : ""}`
      : "Backup processado.";
  }
  if (run.status === "succeeded") return "Execução concluída sem erros.";
  if (run.status === "queued") return "À espera de execução.";
  if (run.status === "running") return "Execução em curso.";
  return "A execução falhou.";
}

function workerDetails(run: WorkerRun) {
  const details: Record<string, unknown> = {};
  if (run.attempts) details.attempts = run.attempts;
  if (run.payload && Object.keys(run.payload as Record<string, unknown>).length) details.payload = run.payload;
  if (run.result && Object.keys(run.result as Record<string, unknown>).length) details.result = run.result;
  return Object.keys(details).length ? JSON.stringify(details, null, 2) : "";
}

function profileMissingText(fields: string[]) {
  return fields.length
    ? `Falta completar: ${fields.join(", ")}.`
    : "Falta completar dados obrigatórios.";
}

function ratingDeltaForType(
  ranking: FideRankingRow | undefined,
  type: RatingType,
): number | undefined {
  if (!ranking) return undefined;
  if (type === "standard") return ranking.deltaStandard;
  if (type === "rapid") return ranking.deltaRapid;
  return ranking.deltaBlitz;
}

function playerLatestRanking(
  player: Player,
  players: Player[],
  month: string | undefined,
  medalMap: Record<string, Medal[]>,
) {
  return buildFideRankingRows(
    players,
    month,
    "combined",
    Object.fromEntries(
      players.map((candidate) => [candidate.id, medalMap[candidate.id]?.length ?? 0]),
    ),
  ).find((row) => row.id === player.id);
}

function gamesForPlayer(games: GameRecord[], player: Player) {
  const normalizedPlayerName = normalizePersonName(player.name);
  return games.filter(
    (game) =>
      game.whitePlayerId === player.id ||
      game.blackPlayerId === player.id ||
      normalizePersonName(game.white) === normalizedPlayerName ||
      normalizePersonName(game.black) === normalizedPlayerName,
  );
}

function trophySeasonsFromEvents(events: EventRecord[]) {
  const seasons = [...new Set(events.map((event) => event.season).filter(Boolean))].sort().reverse();
  return ["Todas", ...seasons];
}

function currentClubSeason(events: EventRecord[]) {
  const seasons = trophySeasonsFromEvents(events).filter((season) => season !== "Todas");
  return seasons[0] ?? "2025/26";
}

function eventDateValue(event: EventRecord) {
  const value = event.endsOn ?? event.startsOn;
  if (value) return Date.parse(value) || 0;
  return eventSortValue(event);
}

function playerParticipatedInEvent(
  event: EventRecord,
  player: Player,
  players: Player[],
) {
  if (event.registrations.includes(player.id)) return true;
  if (event.registrationDetails?.some((registration) => registration.playerId === player.id)) return true;
  if (event.result?.athletes.some((athlete) => samePerson(athlete.name, player.name))) return true;
  if (event.initialRanking?.some((entry) => findTournamentPlayer(players, entry)?.id === player.id)) return true;
  if (event.teamMembers?.some((member) => findTeamMemberPlayer(member, players)?.id === player.id)) return true;
  if (event.live?.standings.some((standing) => findTournamentPlayer(players, standing, event.initialRanking)?.id === player.id)) return true;
  return false;
}

function eventPlayerScore(event: EventRecord, player: Player) {
  return event.result?.athletes.find((athlete) => samePerson(athlete.name, player.name))?.score;
}

function samePerson(a: string, b: string) {
  return normalizePersonName(a) === normalizePersonName(b);
}

function upcomingEventsForPlayer(
  player: Player,
  events: EventRecord[],
  players: Player[],
) {
  const today = todayIsoDate();
  return events
    .filter((event) => event.status !== "completed" && event.status !== "cancelled")
    .filter((event) => !event.endsOn || event.endsOn >= today)
    .filter((event) => playerParticipatedInEvent(event, player, players))
    .sort((a, b) => eventDateValue(a) - eventDateValue(b));
}

function recommendedDeadlinesForPlayer(player: Player, events: EventRecord[]) {
  const today = todayIsoDate();
  return events
    .filter((event) => event.recommended)
    .filter((event) => event.status === "upcoming" || event.status === "registration_open")
    .filter((event) => !event.registrations.includes(player.id))
    .flatMap((event) =>
      event.deadlines.map((deadline) => ({ event, deadline })).filter(({ deadline }) => !deadline.date || deadline.date >= today),
    )
    .sort((a, b) => String(a.deadline.date ?? a.event.startsOn ?? "9999").localeCompare(String(b.deadline.date ?? b.event.startsOn ?? "9999")));
}

function sqToIndex(sq: string) {
  const c = "abcdefgh".indexOf(sq[0]);
  const r = 8 - Number(sq[1]);
  return r * 8 + c;
}
function startBoard() {
  const b = new Array<string | null>(64).fill(null);
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let c = 0; c < 8; c++) {
    b[c] = `b${back[c]}`;
    b[8 + c] = "bP";
    b[48 + c] = "wP";
    b[56 + c] = `w${back[c]}`;
  }
  return b;
}
function moveCoordsForGame(game: GameRecord) {
  const operaMoves = [
    "e4",
    "e5",
    "Nf3",
    "d6",
    "d4",
    "Bg4",
    "dxe5",
    "Bxf3",
    "Qxf3",
    "dxe5",
    "Bc4",
    "Nf6",
    "Qb3",
    "Qe7",
    "Nc3",
    "c6",
    "Bg5",
    "b5",
    "Nxb5",
    "cxb5",
    "Bxb5+",
    "Nbd7",
    "O-O-O",
    "Rd8",
    "Rxd7",
    "Rxd7",
    "Rd1",
    "Qe6",
    "Bxd7+",
    "Nxd7",
    "Qb8+",
    "Nxb8",
    "Rd8#",
  ];
  return game.moves.every((move, index) => move === operaMoves[index])
    ? MOVE_COORDS
    : [];
}

function boardAt(moveCoords: readonly (readonly [string, string])[], ply: number) {
  const b = startBoard();
  for (let i = 0; i < Math.min(ply, moveCoords.length); i++) {
    const [from, to] = moveCoords[i];
    const f = sqToIndex(from),
      t = sqToIndex(to);
    b[t] = b[f];
    b[f] = null;
    if (i === 22) {
      b[sqToIndex("d1")] = b[sqToIndex("a1")];
      b[sqToIndex("a1")] = null;
    }
  }
  return b;
}
function downloadPgn(games: GameRecord[]) {
  const pgn = buildPgnDatabase(games);
  if (!pgn) return;
  const blob = new Blob([`${pgn}\n`], { type: "application/x-chess-pgn" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "efanor_partidas.pgn";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
