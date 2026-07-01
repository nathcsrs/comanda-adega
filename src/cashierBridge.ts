import type { Order, PaymentMethod } from "./types";

const CASHIER_SESSION_KEY = "comanda-adega-caixa-session-v1";
export const SUPABASE_URL = "https://hmjfcxwxmxtwgvxfxajb.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_eHIis5pghFsbnPmLdhDCPg_49FUPUih";

const paymentMap: Record<PaymentMethod, "dinheiro" | "pix" | "credito" | "debito"> = {
  Dinheiro: "dinheiro",
  Pix: "pix",
  "Cartão de crédito": "credito",
  "Cartão de débito": "debito",
};

export interface CashierSession {
  username: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id?: string;
  };
  error?: string;
  error_description?: string;
  message?: string;
}

type CashierEntryRow = {
  id?: string;
  date?: string;
  amount_cents?: number | null;
  payment?: "dinheiro" | "pix" | "credito" | "debito" | string | null;
  description?: string | null;
  entry_time?: string | null;
  created_at?: string | null;
};

const normalizeUsername = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32);

const accountEmail = (username: string) => `${username}@caixa-ta-no-grale.app`;

const accountPassword = (username: string, pin: string) => `Grale-${username}-${pin}-caixa-2026!`;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error || "Não consegui conectar com o caixa.");
};

const readResponse = async <T>(response: Response) => {
  const data = (await response.json().catch(() => ({}))) as T & AuthResponse;

  if (!response.ok) {
    throw new Error(data.error_description || data.message || data.error || "Não consegui conectar com o caixa.");
  }

  return data;
};

const authRequest = async (grantType: "password" | "refresh_token", body: Record<string, string>) => {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await readResponse<AuthResponse>(response);

  if (!data.access_token || !data.refresh_token || !data.user?.id) {
    throw new Error("A conta do caixa não retornou uma sessão válida.");
  }

  return data;
};

const createSession = (username: string, data: AuthResponse): CashierSession => ({
  username,
  userId: String(data.user?.id),
  accessToken: String(data.access_token),
  refreshToken: String(data.refresh_token),
  expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 - 60_000,
});

const getOrderDate = (order: Order) => {
  const date = new Date(order.closedAt || new Date().toISOString());
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const getOrderTime = (order: Order) => {
  const date = new Date(order.closedAt || new Date().toISOString());
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const getShiftFromTime = (time: string) => {
  const hour = Number(time.slice(0, 2));
  if (hour >= 6 && hour < 12) return "manha";
  if (hour >= 12 && hour < 18) return "tarde";
  return "noite";
};

const getOrderTitle = (order: Order) =>
  order.table === "Sem mesa" && order.customer ? order.customer : order.table;

const getOrderDescription = (order: Order) => {
  const customer = order.customer && order.customer !== getOrderTitle(order) ? ` - ${order.customer}` : "";
  const items = order.items.map((item) => `${item.quantity}x ${item.productName}`).join(", ");
  return `Comanda ${getOrderTitle(order)}${customer}${items ? ` (${items})` : ""}`.slice(0, 500);
};

export const getCashierEntryId = (orderId: string) => `comanda-${orderId}`;

const normalizeMatchText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const selectCashierEntries = async (params: URLSearchParams, session: CashierSession) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/cash_entries?${params.toString()}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error_description || "Não consegui consultar o caixa.");
  }

  return (await response.json().catch(() => [])) as CashierEntryRow[];
};

const selectCashierEntryIds = async (params: URLSearchParams, session: CashierSession) => {
  const rows = await selectCashierEntries(params, session);
  return rows.map((row) => row.id).filter(Boolean) as string[];
};

const deleteCashierEntryIds = async (entryIds: string[], session: CashierSession) => {
  if (!entryIds.length) return 0;

  const params = new URLSearchParams({
    user_id: `eq.${session.userId}`,
    id: `in.(${entryIds.map((id) => `"${id}"`).join(",")})`,
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/cash_entries?${params.toString()}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      Prefer: "return=representation",
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error_description || "Não consegui apagar a entrada no caixa.");
  }

  const deletedRows = (await response.json().catch(() => [])) as unknown[];
  return deletedRows.length;
};

export const loadCashierSession = (): CashierSession | null => {
  try {
    const raw = localStorage.getItem(CASHIER_SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as CashierSession) : null;

    if (!parsed?.username || !parsed.userId || !parsed.accessToken || !parsed.refreshToken) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const saveCashierSession = (session: CashierSession) => {
  localStorage.setItem(CASHIER_SESSION_KEY, JSON.stringify(session));
};

export const clearCashierSession = () => {
  localStorage.removeItem(CASHIER_SESSION_KEY);
};

export const loginCashier = async (usernameInput: string, pinInput: string) => {
  const username = normalizeUsername(usernameInput);
  const pin = pinInput.replace(/\D/g, "");

  if (username.length < 3) {
    throw new Error("Informe o usuário do caixa.");
  }

  if (!/^\d{4}$/.test(pin)) {
    throw new Error("O PIN do caixa precisa ter 4 números.");
  }

  const data = await authRequest("password", {
    email: accountEmail(username),
    password: accountPassword(username, pin),
  });
  const session = createSession(username, data);
  saveCashierSession(session);
  return session;
};

export const ensureCashierSession = async (session: CashierSession) => {
  if (session.expiresAt > Date.now()) {
    return session;
  }

  const data = await authRequest("refresh_token", {
    refresh_token: session.refreshToken,
  });
  const refreshed = createSession(session.username, data);
  saveCashierSession(refreshed);
  return refreshed;
};

export const sendOrderToCashier = async (order: Order, session: CashierSession) => {
  const activeSession = await ensureCashierSession(session);
  const totalPaid = order.payment?.totalPaid ?? 0;
  const entryTime = getOrderTime(order);
  const payment = order.payment?.method ? paymentMap[order.payment.method] : "dinheiro";
  const entryId = getCashierEntryId(order.id);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/cash_entries?on_conflict=user_id%2Cid`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${activeSession.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: entryId,
      user_id: activeSession.userId,
      date: getOrderDate(order),
      amount_cents: Math.round(totalPaid * 100),
      payment,
      shift: getShiftFromTime(entryTime),
      sale_number: 0,
      description: getOrderDescription(order),
      entry_time: entryTime,
      created_at: order.closedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error_description || "A comanda foi fechada, mas não entrou no caixa.");
  }

  return { session: activeSession, entryId };
};

export const deleteOrderFromCashier = async (entryId: string, session: CashierSession) => {
  const activeSession = await ensureCashierSession(session);
  await deleteCashierEntryIds([entryId], activeSession);
  return activeSession;
};

export const findCashierEntryForOrder = async (order: Order, session: CashierSession) => {
  const activeSession = await ensureCashierSession(session);
  const directIds = Array.from(
    new Set([order.payment?.cashierEntryId, getCashierEntryId(order.id)].filter(Boolean) as string[]),
  );
  const entryTime = getOrderTime(order);
  const payment = order.payment?.method ? paymentMap[order.payment.method] : "dinheiro";
  const totalPaid = order.payment?.totalPaid ?? 0;
  const description = getOrderDescription(order);

  let matches = directIds.length
    ? await selectCashierEntryIds(
        new URLSearchParams({
          select: "id",
          user_id: `eq.${activeSession.userId}`,
          id: `in.(${directIds.map((id) => `"${id}"`).join(",")})`,
          limit: "1",
        }),
        activeSession,
      )
    : [];

  if (!matches.length) {
    matches = await selectCashierEntryIds(
      new URLSearchParams({
        select: "id",
        user_id: `eq.${activeSession.userId}`,
        date: `eq.${getOrderDate(order)}`,
        amount_cents: `eq.${Math.round(totalPaid * 100)}`,
        payment: `eq.${payment}`,
        entry_time: `eq.${entryTime}`,
        description: `eq.${description}`,
        limit: "1",
      }),
      activeSession,
    );
  }

  if (!matches.length) {
    const title = normalizeMatchText(getOrderTitle(order));
    const customer = order.customer ? normalizeMatchText(order.customer) : "";
    const itemNames = order.items.map((item) => normalizeMatchText(item.productName)).filter(Boolean);
    const candidateRows = await selectCashierEntries(
      new URLSearchParams({
        select: "id,description,entry_time,created_at",
        user_id: `eq.${activeSession.userId}`,
        date: `eq.${getOrderDate(order)}`,
        amount_cents: `eq.${Math.round(totalPaid * 100)}`,
        payment: `eq.${payment}`,
        limit: "50",
      }),
      activeSession,
    );

    const scoredRows = candidateRows
      .filter((row) => row.id)
      .map((row) => {
        const normalizedDescription = normalizeMatchText(row.description ?? "");
        const titleMatch = title && normalizedDescription.includes(title);
        const customerMatch = customer && normalizedDescription.includes(customer);
        const itemMatches = itemNames.filter((itemName) => normalizedDescription.includes(itemName)).length;
        const timeMatch = row.entry_time === entryTime;
        const exactDescription = normalizedDescription === normalizeMatchText(description);
        const identityMatch = exactDescription || titleMatch || customerMatch || itemMatches > 0;
        const score =
          (exactDescription ? 100 : 0) +
          (timeMatch ? 20 : 0) +
          (titleMatch ? 10 : 0) +
          (customerMatch ? 6 : 0) +
          itemMatches;

        return { row, score, identityMatch };
      })
      .filter(({ score, identityMatch }) => identityMatch && score >= 10)
      .sort((first, second) => second.score - first.score);

    const bestScore = scoredRows[0]?.score ?? 0;
    const bestRows = scoredRows.filter((item) => item.score === bestScore);

    if (bestRows.length === 1) {
      matches = [bestRows[0].row.id as string];
    }
  }

  return { session: activeSession, entryId: matches[0] ?? null };
};

export const deleteCashierEntryForOrder = async (order: Order, session: CashierSession) => {
  const result = await findCashierEntryForOrder(order, session);
  const deletedCount = result.entryId ? await deleteCashierEntryIds([result.entryId], result.session) : 0;
  return { session: result.session, deleted: deletedCount > 0, entryId: result.entryId };
};

export const getExistingCashierEntryIds = async (entryIds: string[], session: CashierSession) => {
  if (!entryIds.length) {
    return { session, ids: new Set<string>() };
  }

  const activeSession = await ensureCashierSession(session);
  const params = new URLSearchParams({
    select: "id",
    user_id: `eq.${activeSession.userId}`,
    id: `in.(${entryIds.map((id) => `"${id}"`).join(",")})`,
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/cash_entries?${params.toString()}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${activeSession.accessToken}`,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error_description || "Não consegui conferir o caixa.");
  }

  const rows = (await response.json().catch(() => [])) as Array<{ id?: string }>;
  return {
    session: activeSession,
    ids: new Set(rows.map((row) => row.id).filter(Boolean) as string[]),
  };
};

export const getCashierErrorMessage = getErrorMessage;
