import {
  ensureCashierSession,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  type CashierSession,
} from "./cashierBridge";
import type { AppState, Category, Order, OrderItem, PaymentMethod, Product, Promotion } from "./types";

type CloudData = Pick<AppState, "products" | "promotions" | "openOrders" | "history">;

type ProductRow = {
  id: string;
  name: string;
  category: Category;
  price_cents: number;
  active: boolean;
};

type PromotionRow = {
  id: string;
  product_id: string;
  name?: string | null;
  promotional_price_cents: number;
  start_date: string;
  end_date: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

type OrderRow = {
  id: string;
  table_name: string;
  customer?: string | null;
  opened_at: string;
  closed_at?: string | null;
  status: "Aberta" | "Fechada";
  service_fee_enabled: boolean;
  payment_method?: PaymentMethod | null;
  total_paid_cents?: number | null;
  cashier_entry_id?: string | null;
  cashier_synced_at?: string | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  product_id?: string | null;
  product_name: string;
  category: Category;
  unit_price_cents: number;
  original_unit_price_cents?: number | null;
  quantity: number;
  note?: string | null;
  promotion_id?: string | null;
  promotion_name?: string | null;
  promotion_original_price_cents?: number | null;
  promotion_promotional_price_cents?: number | null;
};

const cents = (value: number) => Math.round(Math.max(0, Number(value) || 0) * 100);

const money = (value?: number | null) => Math.max(0, Number(value ?? 0) || 0) / 100;

const CATEGORY_MIGRATION: Record<string, Category> = {
  Bebidas: "Cerveja Lata",
  Lanches: "Petiscos",
  Porções: "Petiscos",
  Porcoes: "Petiscos",
  Sobremesas: "Guloseimas",
  Grelhados: "Petiscos",
  Petiscos: "Petiscos",
  "Cerveja Lata": "Cerveja Lata",
  "Cerveja Long Neck": "Cerveja Long Neck",
  "Cerveja Garrafa": "Cerveja Garrafa",
  "Não Alcoolicos": "Não Alcoolicos",
  "Não Alcoólicos": "Não Alcoolicos",
  "Nao Alcoolicos": "Não Alcoolicos",
  Guloseimas: "Guloseimas",
  Outros: "Outros",
};

const normalizeCategory = (category: unknown): Category =>
  typeof category === "string" ? CATEGORY_MIGRATION[category] ?? "Outros" : "Outros";

const cloudHeaders = (session: CashierSession, prefer?: string) => ({
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${session.accessToken}`,
  "Content-Type": "application/json",
  ...(prefer ? { Prefer: prefer } : {}),
});

const readJson = async <T>(response: Response, fallback: T): Promise<T> => {
  const data = await response.json().catch(() => fallback);

  if (!response.ok) {
    const errorData = data as { message?: string; error?: string; error_description?: string };
    throw new Error(errorData.message || errorData.error_description || errorData.error || "Não consegui sincronizar com a nuvem.");
  }

  return data as T;
};

const request = async <T>(
  session: CashierSession,
  table: string,
  query = "",
  options: RequestInit = {},
  fallback: T,
) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    ...options,
    headers: {
      ...cloudHeaders(session, options.method === "POST" ? "resolution=merge-duplicates,return=minimal" : undefined),
      ...(options.headers ?? {}),
    },
  });

  return readJson<T>(response, fallback);
};

const productToRow = (product: Product, session: CashierSession): ProductRow & { user_id: string } => ({
  id: product.id,
  user_id: session.userId,
  name: product.name,
  category: product.category,
  price_cents: cents(product.price),
  active: product.active,
});

const rowToProduct = (row: ProductRow): Product => ({
  id: row.id,
  name: row.name,
  category: normalizeCategory(row.category),
  price: money(row.price_cents),
  active: Boolean(row.active),
});

const promotionToRow = (promotion: Promotion, session: CashierSession): PromotionRow & { user_id: string } => ({
  id: promotion.id,
  user_id: session.userId,
  product_id: promotion.productId,
  name: promotion.name ?? null,
  promotional_price_cents: cents(promotion.promotionalPrice),
  start_date: promotion.startDate,
  end_date: promotion.endDate,
  active: promotion.active,
  created_at: promotion.createdAt,
  updated_at: promotion.updatedAt,
});

const rowToPromotion = (row: PromotionRow): Promotion => ({
  id: row.id,
  productId: row.product_id,
  name: row.name?.trim() || undefined,
  promotionalPrice: money(row.promotional_price_cents),
  startDate: row.start_date,
  endDate: row.end_date,
  active: Boolean(row.active),
  createdAt: row.created_at || new Date().toISOString(),
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
});

const orderToRow = (order: Order, session: CashierSession): OrderRow & { user_id: string } => ({
  id: order.id,
  user_id: session.userId,
  table_name: order.table,
  customer: order.customer ?? null,
  opened_at: order.openedAt,
  closed_at: order.closedAt ?? null,
  status: order.status,
  service_fee_enabled: false,
  payment_method: order.payment?.method ?? null,
  total_paid_cents: order.payment ? cents(order.payment.totalPaid) : null,
  cashier_entry_id: order.payment?.cashierEntryId ?? null,
  cashier_synced_at: order.payment?.cashierSyncedAt ?? null,
});

const rowToOrder = (row: OrderRow, items: OrderItem[]): Order => ({
  id: row.id,
  table: row.table_name,
  customer: row.customer ?? undefined,
  openedAt: row.opened_at,
  closedAt: row.closed_at ?? undefined,
  status: row.status,
  serviceFeeEnabled: false,
  items,
  payment:
    row.payment_method && typeof row.total_paid_cents === "number"
      ? {
          method: row.payment_method,
          totalPaid: money(row.total_paid_cents),
          cashierEntryId: row.cashier_entry_id ?? undefined,
          cashierSyncedAt: row.cashier_synced_at ?? undefined,
        }
      : undefined,
});

const itemToRow = (item: OrderItem, orderId: string, session: CashierSession): OrderItemRow & { user_id: string } => ({
  id: item.id,
  user_id: session.userId,
  order_id: orderId,
  product_id: item.productId,
  product_name: item.productName,
  category: item.category,
  unit_price_cents: cents(item.unitPrice),
  original_unit_price_cents: cents(item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice),
  quantity: item.quantity,
  note: item.note ?? null,
  promotion_id: item.promotion?.id ?? null,
  promotion_name: item.promotion?.name ?? null,
  promotion_original_price_cents: item.promotion ? cents(item.promotion.originalPrice) : null,
  promotion_promotional_price_cents: item.promotion ? cents(item.promotion.promotionalPrice) : null,
});

const rowToItem = (row: OrderItemRow): OrderItem => ({
  id: row.id,
  productId: row.product_id ?? "",
  productName: row.product_name,
  category: normalizeCategory(row.category),
  unitPrice: money(row.unit_price_cents),
  originalUnitPrice:
    typeof row.original_unit_price_cents === "number" ? money(row.original_unit_price_cents) : money(row.unit_price_cents),
  quantity: row.quantity,
  note: row.note ?? undefined,
  promotion:
    row.promotion_id && typeof row.promotion_original_price_cents === "number" && typeof row.promotion_promotional_price_cents === "number"
      ? {
          id: row.promotion_id,
          name: row.promotion_name ?? undefined,
          originalPrice: money(row.promotion_original_price_cents),
          promotionalPrice: money(row.promotion_promotional_price_cents),
        }
      : undefined,
});

const allOrders = (state: Pick<AppState, "openOrders" | "history">) => [...state.openOrders, ...state.history];

const cloudHasData = (data: CloudData) =>
  data.products.length > 0 || data.promotions.length > 0 || data.openOrders.length > 0 || data.history.length > 0;

export const hasCloudData = cloudHasData;

export const loadComandaCloudState = async (session: CashierSession) => {
  const activeSession = await ensureCashierSession(session);
  const [products, promotions, orders, items] = await Promise.all([
    request<ProductRow[]>(activeSession, "comanda_products", "?select=*", {}, []),
    request<PromotionRow[]>(activeSession, "comanda_promotions", "?select=*", {}, []),
    request<OrderRow[]>(activeSession, "comanda_orders", "?select=*", {}, []),
    request<OrderItemRow[]>(activeSession, "comanda_order_items", "?select=*", {}, []),
  ]);

  const itemsByOrder = new Map<string, OrderItem[]>();
  items.forEach((row) => {
    const currentItems = itemsByOrder.get(row.order_id) ?? [];
    currentItems.push(rowToItem(row));
    itemsByOrder.set(row.order_id, currentItems);
  });

  const mappedOrders = orders.map((row) => rowToOrder(row, itemsByOrder.get(row.id) ?? []));

  return {
    session: activeSession,
    data: {
      products: products.map(rowToProduct),
      promotions: promotions.map(rowToPromotion),
      openOrders: mappedOrders.filter((order) => order.status === "Aberta"),
      history: mappedOrders.filter((order) => order.status === "Fechada"),
    } satisfies CloudData,
  };
};

export const syncComandaCloudState = async (state: AppState, session: CashierSession) => {
  const activeSession = await ensureCashierSession(session);
  const orders = allOrders(state);
  const orderItems = orders.flatMap((order) => order.items.map((item) => itemToRow(item, order.id, activeSession)));

  if (state.products.length) {
    await request(activeSession, "comanda_products?on_conflict=user_id%2Cid", "", {
      method: "POST",
      body: JSON.stringify(state.products.map((product) => productToRow(product, activeSession))),
    }, {});
  }

  if (state.promotions.length) {
    await request(activeSession, "comanda_promotions?on_conflict=user_id%2Cid", "", {
      method: "POST",
      body: JSON.stringify(state.promotions.map((promotion) => promotionToRow(promotion, activeSession))),
    }, {});
  }

  if (orders.length) {
    await request(activeSession, "comanda_orders?on_conflict=user_id%2Cid", "", {
      method: "POST",
      body: JSON.stringify(orders.map((order) => orderToRow(order, activeSession))),
    }, {});
  }

  await request(activeSession, "comanda_order_items", `?user_id=eq.${activeSession.userId}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }, {});

  if (orderItems.length) {
    await request(activeSession, "comanda_order_items?on_conflict=user_id%2Cid", "", {
      method: "POST",
      body: JSON.stringify(orderItems),
    }, {});
  }

  return activeSession;
};

const deleteById = async (session: CashierSession, table: string, id: string) => {
  const activeSession = await ensureCashierSession(session);
  await request(activeSession, table, `?user_id=eq.${activeSession.userId}&id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }, {});
  return activeSession;
};

export const deleteCloudProduct = (session: CashierSession, productId: string) =>
  deleteById(session, "comanda_products", productId);

export const deleteCloudPromotion = (session: CashierSession, promotionId: string) =>
  deleteById(session, "comanda_promotions", promotionId);

export const deleteCloudOrder = (session: CashierSession, orderId: string) =>
  deleteById(session, "comanda_orders", orderId);

export const mergeLocalWithCloud = (localState: AppState, cloudData: CloudData): AppState => {
  if (cloudHasData(cloudData)) {
    return {
      ...localState,
      products: cloudData.products,
      promotions: cloudData.promotions,
      openOrders: cloudData.openOrders,
      history: cloudData.history,
    };
  }

  return localState;
};
