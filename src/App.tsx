import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Banknote,
  Beer,
  BadgeCheck,
  Candy,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CalendarDays,
  Clock3,
  CreditCard,
  Edit3,
  CupSoda,
  GlassWater,
  KeyRound,
  Link2,
  LogOut,
  MessageCircle,
  Minus,
  Package,
  Plus,
  QrCode,
  ReceiptText,
  Save,
  Search,
  Snowflake,
  Tag,
  Trash2,
  UserRound,
  Utensils,
  Wine,
  X,
} from "lucide-react";
import {
  clearCashierSession,
  deleteCashierEntryForOrder,
  findCashierEntryForOrder,
  getExistingCashierEntryIds,
  getCashierErrorMessage,
  loadCashierSession,
  loginCashier,
  sendOrderToCashier,
  type CashierSession,
} from "./cashierBridge";
import {
  deleteCloudOrder,
  deleteCloudProduct,
  deleteCloudPromotion,
  hasCloudData,
  loadComandaCloudState,
  mergeLocalWithCloud,
  syncComandaCloudState,
} from "./comandaCloud";
import { loadState, saveState } from "./storage";
import {
  CATEGORIES,
  type AppSettings,
  type AppState,
  type Category,
  type Order,
  type OrderItem,
  type PaymentMethod,
  type Product,
  type Promotion,
} from "./types";
import {
  calculateOrderTotals,
  createId,
  formatCurrency,
  formatCurrencyInput,
  formatDateTime,
  formatTime,
  normalizeText,
  parseCurrencyInput,
} from "./utils";

type Tab = "orders" | "products" | "history";
type ToastKind = "success" | "error" | "info";
type ProductDraft = Pick<Product, "name" | "category" | "price" | "active">;
type ProductAreaTab = "products" | "promotions";
type PromotionFilter = "Todas" | "Ativas" | "Encerradas" | "Agendadas";
type PromotionStatus = "Ativa" | "Encerrada" | "Agendada" | "Inativa";
type PromotionDraft = {
  productId: string;
  promotionalPrice: number;
  name: string;
  startDate: string;
  endDate: string;
  onlyToday: boolean;
  active: boolean;
};
type CategoryVisual = { icon: typeof Beer; className: string; label: string };
type CashierLoginDraft = { username: string; pin: string };

interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

const paymentOptions: Array<{ value: PaymentMethod; icon: typeof Banknote }> = [
  { value: "Dinheiro", icon: Banknote },
  { value: "Pix", icon: QrCode },
  { value: "Cartão de crédito", icon: CreditCard },
  { value: "Cartão de débito", icon: CreditCard },
];

const getPublicAsset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const LOGO_SRC = getPublicAsset("adega-ta-no-grale-logo.jpg");
const NO_TABLE_LABEL = "Sem mesa";
const DELETED_ORDER_IDS_KEY = "comanda-adega-deleted-order-ids-v1";
const tableOptions = Array.from({ length: 7 }, (_, index) => `Mesa ${index + 1}`);

type DeletedOrderStore = Record<string, string[]>;

const getDeletedOrderStore = (): DeletedOrderStore => {
  try {
    const raw = localStorage.getItem(DELETED_ORDER_IDS_KEY);
    return raw ? (JSON.parse(raw) as DeletedOrderStore) : {};
  } catch {
    return {};
  }
};

const getDeletedOrderIds = (userId?: string) => new Set(getDeletedOrderStore()[userId ?? "local"] ?? []);

const rememberDeletedOrderIds = (userId: string | undefined, orderIds: string[]) => {
  if (!orderIds.length) return;

  const key = userId ?? "local";
  const store = getDeletedOrderStore();
  const mergedIds = Array.from(new Set([...(store[key] ?? []), ...orderIds])).slice(-500);

  localStorage.setItem(DELETED_ORDER_IDS_KEY, JSON.stringify({ ...store, [key]: mergedIds }));
};

const categoryVisuals: Record<Category, CategoryVisual> = {
  "Cerveja Lata": { icon: Beer, className: "category-cerveja-lata", label: "Lata" },
  "Cerveja Long Neck": { icon: Wine, className: "category-cerveja-long-neck", label: "Long neck" },
  "Cerveja Garrafa": { icon: GlassWater, className: "category-cerveja-garrafa", label: "Garrafa" },
  "Não Alcoolicos": { icon: CupSoda, className: "category-nao-alcoolicos", label: "Sem álcool" },
  Guloseimas: { icon: Candy, className: "category-guloseimas", label: "Doce" },
  Petiscos: { icon: Utensils, className: "category-petiscos", label: "Petiscos" },
  Outros: { icon: Package, className: "category-outros", label: "Geral" },
};

const getOrderTitle = (order: Order) =>
  order.table === NO_TABLE_LABEL && order.customer ? order.customer : order.table;

const shouldShowCustomer = (order: Order) => Boolean(order.customer && getOrderTitle(order) !== order.customer);

const getLocalDateInput = (date = new Date()) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
};

const formatDateOnly = (dateValue: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

const getPromotionStatus = (promotion: Promotion, today = getLocalDateInput()): PromotionStatus => {
  if (!promotion.active) return "Inativa";
  if (promotion.startDate > today) return "Agendada";
  if (promotion.endDate < today) return "Encerrada";
  return "Ativa";
};

const getPromotionTagText = (promotion: Promotion) => promotion.name?.trim() || "PROMOÇÃO";

const getActivePromotionForProduct = (productId: string, promotions: Promotion[], today = getLocalDateInput()) =>
  promotions
    .filter((promotion) => promotion.productId === productId && getPromotionStatus(promotion, today) === "Ativa")
    .sort((first, second) => String(second.updatedAt).localeCompare(String(first.updatedAt)))[0] ?? null;

const getApplicablePromotionForProduct = (product: Product, promotions: Promotion[]) => {
  const promotion = getActivePromotionForProduct(product.id, promotions);
  return promotion && promotion.promotionalPrice < product.price ? promotion : null;
};

const dateRangesOverlap = (firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) =>
  firstStart <= secondEnd && secondStart <= firstEnd;

const isPromotionalItem = (item: OrderItem) =>
  Boolean(item.promotion && (item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice) > item.unitPrice);

const buildWhatsAppOrderMessage = (order: Order) => {
  const totals = calculateOrderTotals(order);
  const total = order.payment?.totalPaid ?? totals.total;
  const lines = [
    "*Adega Tá no Grale*",
    order.status === "Fechada" ? "*Comanda fechada*" : "*Comanda aberta*",
    "",
    `${getOrderTitle(order)}`,
    order.customer ? `Cliente: ${order.customer}` : null,
    `Aberta em: ${formatDateTime(order.openedAt)}`,
    order.closedAt ? `Fechada em: ${formatDateTime(order.closedAt)}` : null,
    "",
    "*Itens:*",
    ...order.items.flatMap((item) => [
      `${item.quantity}x ${item.productName} - ${formatCurrency(item.quantity * item.unitPrice)}`,
      isPromotionalItem(item)
        ? `Promoção: ${item.promotion?.name || "PROMOÇÃO"} (${formatCurrency(item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice)} por ${formatCurrency(item.unitPrice)})`
        : null,
      item.note ? `Obs: ${item.note}` : null,
    ]),
    "",
    `Subtotal: ${formatCurrency(totals.subtotal)}`,
    order.payment?.method ? `Pagamento: ${order.payment.method}` : null,
    `Total: ${formatCurrency(total)}`,
  ];

  return lines.filter((line): line is string => Boolean(line)).join("\n");
};

const shareOrderOnWhatsApp = (order: Order) => {
  const message = encodeURIComponent(buildWhatsAppOrderMessage(order));
  window.open(`https://wa.me/?text=${message}`, "_blank", "noopener,noreferrer");
};

const getLocalDayRange = (dateValue: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return {
    start: new Date(year, month - 1, day, 0, 0, 0, 0).getTime(),
    end: new Date(year, month - 1, day, 23, 59, 59, 999).getTime(),
  };
};

const emptyProductDraft: ProductDraft = {
  name: "",
  category: "Cerveja Lata",
  price: 0,
  active: true,
};

const createEmptyPromotionDraft = (productId = ""): PromotionDraft => {
  const today = getLocalDateInput();

  return {
    productId,
    promotionalPrice: 0,
    name: "",
    startDate: today,
    endDate: today,
    onlyToday: true,
    active: true,
  };
};

function App() {
  const [initialAppState] = useState<AppState>(() => loadState());
  const [products, setProducts] = useState<Product[]>(() => initialAppState.products);
  const [promotions, setPromotions] = useState<Promotion[]>(() => initialAppState.promotions);
  const [openOrders, setOpenOrders] = useState<Order[]>(() => initialAppState.openOrders);
  const [history, setHistory] = useState<Order[]>(() => initialAppState.history);
  const [settings] = useState<AppSettings>(() => initialAppState.settings);
  const [activeTab, setActiveTab] = useState<Tab>("orders");
  const [productAreaTab, setProductAreaTab] = useState<ProductAreaTab>("products");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [searchOrders, setSearchOrders] = useState("");
  const [searchProducts, setSearchProducts] = useState("");
  const [searchPromotions, setSearchPromotions] = useState("");
  const [promotionFilter, setPromotionFilter] = useState<PromotionFilter>("Todas");
  const [searchHistory, setSearchHistory] = useState("");
  const [historyDateFilter, setHistoryDateFilter] = useState("");
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState<PaymentMethod | "Todos">("Todos");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [productToAdd, setProductToAdd] = useState<Product | null>(null);
  const [quantityToAdd, setQuantityToAdd] = useState(1);
  const [itemNote, setItemNote] = useState("");
  const [showCloseOrder, setShowCloseOrder] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Dinheiro");
  const [cashierSession, setCashierSession] = useState<CashierSession | null>(() => loadCashierSession());
  const [cashierLogin, setCashierLogin] = useState<CashierLoginDraft>(() => ({
    username: loadCashierSession()?.username ?? "",
    pin: "",
  }));
  const [cashierConnecting, setCashierConnecting] = useState(false);
  const [closingPayment, setClosingPayment] = useState(false);
  const [productEditor, setProductEditor] = useState<Product | "new" | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProductDraft);
  const [promotionEditor, setPromotionEditor] = useState<Promotion | "new" | null>(null);
  const [promotionDraft, setPromotionDraft] = useState<PromotionDraft>(() => createEmptyPromotionDraft());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);
  const [paymentDone, setPaymentDone] = useState<Order | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const cloudBootstrappedUserRef = useRef<string | null>(null);
  const applyingCloudStateRef = useRef(false);

  const selectedOrder = useMemo(
    () => openOrders.find((order) => order.id === selectedOrderId) ?? null,
    [openOrders, selectedOrderId],
  );

  const selectedHistory = useMemo(
    () => history.find((order) => order.id === selectedHistoryId) ?? null,
    [history, selectedHistoryId],
  );

  const appState = useMemo(
    () => ({ products, promotions, openOrders, history, settings }),
    [products, promotions, openOrders, history, settings],
  );

  useEffect(() => {
    saveState(appState);
  }, [appState]);

  useEffect(() => {
    if (!cashierSession) {
      cloudBootstrappedUserRef.current = null;
      setCloudReady(false);
      return;
    }

    if (cloudBootstrappedUserRef.current === cashierSession.userId) {
      return;
    }

    let cancelled = false;

    const bootstrapCloud = async () => {
      applyingCloudStateRef.current = true;
      setCloudReady(false);

      try {
        const result = await loadComandaCloudState(cashierSession);
        let activeSession = result.session;
        const deletedOrderIds = getDeletedOrderIds(activeSession.userId);
        const deletedCloudOrderIds = [...result.data.openOrders, ...result.data.history]
          .filter((order) => deletedOrderIds.has(order.id))
          .map((order) => order.id);
        const cloudData = {
          ...result.data,
          openOrders: result.data.openOrders.filter((order) => !deletedOrderIds.has(order.id)),
          history: result.data.history.filter((order) => !deletedOrderIds.has(order.id)),
        };

        for (const orderId of deletedCloudOrderIds) {
          try {
            activeSession = await deleteCloudOrder(activeSession, orderId);
          } catch {
            // A memória local evita que a comanda apagada reapareça mesmo se a limpeza da nuvem falhar agora.
          }
        }

        const mergedState = mergeLocalWithCloud(appState, cloudData);

        if (cancelled) return;

        setCashierSession(activeSession);
        setProducts(mergedState.products);
        setPromotions(mergedState.promotions);
        setOpenOrders(mergedState.openOrders);
        setHistory(mergedState.history);

        const syncedSession = await syncComandaCloudState(mergedState, activeSession);

        if (cancelled) return;

        setCashierSession(syncedSession);
        cloudBootstrappedUserRef.current = syncedSession.userId;
        applyingCloudStateRef.current = false;
        setCloudReady(true);
        showToast(hasCloudData(cloudData) ? "success" : "info", hasCloudData(cloudData) ? "Dados carregados da nuvem." : "Nuvem pronta para salvar os dados.");
      } catch (error) {
        if (cancelled) return;

        applyingCloudStateRef.current = false;
        setCloudReady(false);
        showToast("error", `Não consegui sincronizar a nuvem: ${getCashierErrorMessage(error)}`);
      }
    };

    void bootstrapCloud();

    return () => {
      cancelled = true;
    };
  }, [cashierSession?.userId]);

  useEffect(() => {
    if (!cashierSession || !cloudReady || applyingCloudStateRef.current) return;

    const timer = window.setTimeout(() => {
      void syncComandaCloudState(appState, cashierSession)
        .then((session) => setCashierSession(session))
        .catch((error) => showToast("error", `Dados salvos no aparelho, mas não na nuvem: ${getCashierErrorMessage(error)}`));
    }, 900);

    return () => window.clearTimeout(timer);
  }, [appState, cashierSession, cloudReady]);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!cashierSession) return;

    let cancelled = false;

    const syncDeletedCashierEntries = async () => {
      const linkedEntryIds = Array.from(
        new Set(history.map((order) => order.payment?.cashierEntryId).filter(Boolean) as string[]),
      );

      try {
        let activeSession = cashierSession;
        let deletedEntryIds = new Set<string>();

        if (linkedEntryIds.length) {
          const result = await getExistingCashierEntryIds(linkedEntryIds, activeSession);
          activeSession = result.session;
          deletedEntryIds = new Set(linkedEntryIds.filter((entryId) => !result.ids.has(entryId)));
        }

        const unlinkedOrders = history.filter((order) => order.payment && !order.payment.cashierEntryId);
        const foundLinks: Array<{ orderId: string; entryId: string }> = [];

        for (const order of unlinkedOrders) {
          const result = await findCashierEntryForOrder(order, activeSession);
          activeSession = result.session;
          if (result.entryId) {
            foundLinks.push({ orderId: order.id, entryId: result.entryId });
          }
        }

        const ordersDeletedInCashier = history.filter((order) => {
          const cashierEntryId = order.payment?.cashierEntryId;
          return cashierEntryId && deletedEntryIds.has(cashierEntryId);
        });

        if (ordersDeletedInCashier.length) {
          rememberDeletedOrderIds(
            activeSession.userId,
            ordersDeletedInCashier.map((order) => order.id),
          );

          for (const order of ordersDeletedInCashier) {
            try {
              activeSession = await deleteCloudOrder(activeSession, order.id);
            } catch {
              // O histórico local já sabe que o caixa apagou. A memória de exclusão impede retorno indevido.
            }
          }
        }

        if (cancelled) return;

        setCashierSession(activeSession);

        if (ordersDeletedInCashier.length) {
          const removedOrderIds = new Set(ordersDeletedInCashier.map((order) => order.id));

          setHistory((orders) => orders.filter((order) => !removedOrderIds.has(order.id)));

          if (selectedHistoryId && removedOrderIds.has(selectedHistoryId)) {
            setSelectedHistoryId(null);
          }

          showToast("info", "Histórico sincronizado com o caixa.");
        }

        if (foundLinks.length) {
          setHistory((orders) =>
            orders.map((order) => {
              const foundLink = foundLinks.find((link) => link.orderId === order.id);
              if (!foundLink || !order.payment) return order;

              return {
                ...order,
                payment: {
                  ...order.payment,
                  cashierEntryId: foundLink.entryId,
                  cashierSyncedAt: new Date().toISOString(),
                },
              };
            }),
          );
        }
      } catch {
        // Se estiver sem internet, mantem o histórico local até a próxima sincronização.
      }
    };

    void syncDeletedCashierEntries();
    const syncTimer = window.setInterval(syncDeletedCashierEntries, 15_000);
    window.addEventListener("focus", syncDeletedCashierEntries);

    return () => {
      cancelled = true;
      window.clearInterval(syncTimer);
      window.removeEventListener("focus", syncDeletedCashierEntries);
    };
  }, [cashierSession, history, selectedHistoryId]);

  const showToast = (kind: ToastKind, message: string) => {
    setToast({ id: Date.now(), kind, message });
  };

  const askConfirmation = (dialog: ConfirmState) => {
    setConfirmDialog(dialog);
  };

  const runCloudDelete = async (
    action: (session: CashierSession) => Promise<CashierSession>,
    errorMessage: string,
  ) => {
    if (!cashierSession) {
      return true;
    }

    try {
      const session = await action(cashierSession);
      setCashierSession(session);
      return true;
    } catch (error) {
      showToast("error", `${errorMessage}: ${getCashierErrorMessage(error)}`);
      return false;
    }
  };

  const connectCashier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCashierConnecting(true);

    try {
      const session = await loginCashier(cashierLogin.username, cashierLogin.pin);
      setCashierSession(session);
      setCashierLogin({ username: session.username, pin: "" });
      showToast("success", "Login feito com sucesso.");
    } catch (error) {
      showToast("error", getCashierErrorMessage(error));
    } finally {
      setCashierConnecting(false);
    }
  };

  const disconnectCashier = () => {
    clearCashierSession();
    setCashierSession(null);
    setCashierLogin((draft) => ({ ...draft, pin: "" }));
    setSelectedOrderId(null);
    setSelectedHistoryId(null);
    setShowNewOrder(false);
    setShowAddItem(false);
    setShowCloseOrder(false);
    setProductEditor(null);
    setPromotionEditor(null);
    setPaymentDone(null);
    setCloudReady(false);
    cloudBootstrappedUserRef.current = null;
    showToast("info", "Você saiu do app.");
  };

  const currentOrderTotals = selectedOrder ? calculateOrderTotals(selectedOrder) : null;

  const filteredOpenOrders = useMemo(() => {
    const query = normalizeText(searchOrders);

    return openOrders
      .filter((order) => {
        if (!query) return true;
        return normalizeText(`${order.table} ${order.customer ?? ""}`).includes(query);
      })
      .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
  }, [openOrders, searchOrders]);

  const filteredProducts = useMemo(() => {
    const query = normalizeText(searchProducts);

    return products
      .filter((product) => !query || normalizeText(product.name).includes(query))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [products, searchProducts]);

  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const filteredPromotions = useMemo(() => {
    const query = normalizeText(searchPromotions);

    return promotions
      .filter((promotion) => {
        const product = productsById.get(promotion.productId);
        const status = getPromotionStatus(promotion);
        const matchesText =
          !query || normalizeText(`${product?.name ?? ""} ${promotion.name ?? ""}`).includes(query);
        const matchesStatus =
          promotionFilter === "Todas" ||
          (promotionFilter === "Ativas" && status === "Ativa") ||
          (promotionFilter === "Encerradas" && status === "Encerrada") ||
          (promotionFilter === "Agendadas" && status === "Agendada");

        return matchesText && matchesStatus;
      })
      .sort((a, b) => {
        const statusOrder: Record<PromotionStatus, number> = {
          Ativa: 0,
          Agendada: 1,
          Inativa: 2,
          Encerrada: 3,
        };
        return statusOrder[getPromotionStatus(a)] - statusOrder[getPromotionStatus(b)] || a.startDate.localeCompare(b.startDate);
      });
  }, [productsById, promotionFilter, promotions, searchPromotions]);

  const filteredHistory = useMemo(() => {
    const query = normalizeText(searchHistory);
    const dayRange = historyDateFilter ? getLocalDayRange(historyDateFilter) : null;

    return history
      .filter((order) => {
        const matchesText = !query || normalizeText(`${order.table} ${order.customer ?? ""}`).includes(query);
        const matchesPayment = historyPaymentFilter === "Todos" || order.payment?.method === historyPaymentFilter;
        const closedAt = new Date(order.closedAt ?? "").getTime();
        const matchesDate = !dayRange || (closedAt >= dayRange.start && closedAt <= dayRange.end);
        return matchesText && matchesPayment && matchesDate;
      })
      .sort((a, b) => new Date(b.closedAt ?? "").getTime() - new Date(a.closedAt ?? "").getTime());
  }, [history, historyDateFilter, historyPaymentFilter, searchHistory]);

  const createOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const table = String(formData.get("table") ?? "").trim();
    const customer = String(formData.get("customer") ?? "").trim();

    if (!customer) {
      showToast("error", "Informe o nome do cliente.");
      return;
    }

    const newOrder: Order = {
      id: createId("comanda"),
      table: table || NO_TABLE_LABEL,
      customer,
      openedAt: new Date().toISOString(),
      status: "Aberta",
      items: [],
      serviceFeeEnabled: false,
    };

    setOpenOrders((orders) => [newOrder, ...orders]);
    setSelectedOrderId(newOrder.id);
    setShowNewOrder(false);
    setActiveTab("orders");
    showToast("success", "Comanda aberta com sucesso.");
  };

  const updateSelectedOrder = (updater: (order: Order) => Order) => {
    if (!selectedOrderId) return;

    setOpenOrders((orders) =>
      orders.map((order) => (order.id === selectedOrderId ? updater(order) : order)),
    );
  };

  const changeItemQuantity = (itemId: string, delta: number) => {
    const item = selectedOrder?.items.find((orderItem) => orderItem.id === itemId);
    if (!item) return;

    if (item.quantity + delta <= 0) {
      askConfirmation({
        title: "Remover item",
        message: `Deseja remover ${item.productName} da comanda?`,
        confirmLabel: "Remover",
        danger: true,
        onConfirm: () => removeItem(itemId),
      });
      return;
    }

    updateSelectedOrder((order) => ({
      ...order,
      items: order.items.map((orderItem) =>
        orderItem.id === itemId
          ? { ...orderItem, quantity: Math.max(1, orderItem.quantity + delta) }
          : orderItem,
      ),
    }));
  };

  const removeItem = (itemId: string) => {
    updateSelectedOrder((order) => ({
      ...order,
      items: order.items.filter((item) => item.id !== itemId),
    }));
    showToast("success", "Item removido.");
  };

  const confirmAddProduct = () => {
    if (!productToAdd || !selectedOrder) return;
    const safeQuantity = Math.max(1, quantityToAdd);
    const cleanNote = itemNote.trim();
    const activePromotion = getApplicablePromotionForProduct(productToAdd, promotions);
    const appliedPrice = activePromotion?.promotionalPrice ?? productToAdd.price;

    const newItem: OrderItem = {
      id: createId("item"),
      productId: productToAdd.id,
      productName: productToAdd.name,
      category: productToAdd.category,
      unitPrice: appliedPrice,
      originalUnitPrice: productToAdd.price,
      promotion: activePromotion
        ? {
            id: activePromotion.id,
            name: activePromotion.name,
            originalPrice: productToAdd.price,
            promotionalPrice: activePromotion.promotionalPrice,
          }
        : undefined,
      quantity: safeQuantity,
      note: cleanNote || undefined,
    };

    updateSelectedOrder((order) => {
      const repeatedItem = order.items.find(
        (item) =>
          item.productId === newItem.productId &&
          (item.note ?? "") === (newItem.note ?? "") &&
          item.unitPrice === newItem.unitPrice &&
          (item.promotion?.id ?? "") === (newItem.promotion?.id ?? ""),
      );

      if (!repeatedItem) {
        return { ...order, items: [...order.items, newItem] };
      }

      return {
        ...order,
        items: order.items.map((item) =>
          item.id === repeatedItem.id
            ? { ...item, quantity: item.quantity + safeQuantity }
            : item,
        ),
      };
    });

    setProductToAdd(null);
    setQuantityToAdd(1);
    setItemNote("");
    setShowAddItem(false);
    showToast("success", "Item adicionado.");
  };

  const openCloseOrder = () => {
    if (!selectedOrder) return;

    if (selectedOrder.items.length === 0) {
      showToast("error", "Adicione pelo menos um item antes de fechar.");
      return;
    }

    setPaymentMethod("Dinheiro");
    setShowCloseOrder(true);
  };

  const deleteOpenOrder = (order: Order) => {
    askConfirmation({
      title: "Excluir comanda",
      message: `Deseja excluir a comanda ${getOrderTitle(order)}? Essa ação remove a comanda aberta e seus itens.`,
      confirmLabel: "Excluir",
      danger: true,
      onConfirm: async () => {
        const cloudDeleted = await runCloudDelete(
          (session) => deleteCloudOrder(session, order.id),
          "Não apaguei a comanda na nuvem",
        );
        if (!cloudDeleted) return;

        rememberDeletedOrderIds(cashierSession?.userId, [order.id]);
        setOpenOrders((orders) => orders.filter((item) => item.id !== order.id));
        setSelectedOrderId(null);
        showToast("success", "Comanda excluída.");
      },
    });
  };

  const confirmPayment = async () => {
    if (!selectedOrder || closingPayment) return;
    setClosingPayment(true);

    const totals = calculateOrderTotals(selectedOrder);

    let closedOrder: Order = {
      ...selectedOrder,
      status: "Fechada",
      closedAt: new Date().toISOString(),
      payment: {
        method: paymentMethod,
        totalPaid: totals.total,
      },
    };

    let cashierSent = false;
    let cashierError = "";

    if (cashierSession) {
      try {
        const result = await sendOrderToCashier(closedOrder, cashierSession);
        setCashierSession(result.session);
        closedOrder = {
          ...closedOrder,
          payment: {
            method: paymentMethod,
            totalPaid: totals.total,
            cashierEntryId: result.entryId,
            cashierSyncedAt: new Date().toISOString(),
          },
        };
        cashierSent = true;
      } catch (error) {
        cashierError = getCashierErrorMessage(error);
      }
    }

    setOpenOrders((orders) => orders.filter((order) => order.id !== selectedOrder.id));
    setHistory((orders) => [closedOrder, ...orders]);
    setSelectedOrderId(null);
    setShowCloseOrder(false);
    setPaymentDone(closedOrder);
    setClosingPayment(false);

    if (cashierError) {
      showToast("error", `Comanda fechada, mas não foi para o caixa: ${cashierError}`);
      return;
    }

    showToast(
      "success",
      cashierSent ? "Comanda fechada e enviada ao caixa." : "Comanda fechada. Conecte o caixa para enviar automático.",
    );
  };

  const openProductEditor = (product: Product | "new") => {
    setProductEditor(product);
    setProductDraft(
      product === "new"
        ? emptyProductDraft
        : {
            name: product.name,
            category: product.category,
            price: product.price,
            active: product.active,
          },
    );
  };

  const saveProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = productDraft.name.trim();
    const price = Math.max(0, productDraft.price);

    if (!name) {
      showToast("error", "Informe o nome do produto.");
      return;
    }

    if (productEditor === "new") {
      const newProduct: Product = {
        id: createId("produto"),
        name,
        category: productDraft.category,
        price,
        active: productDraft.active,
      };

      setProducts((currentProducts) => [...currentProducts, newProduct]);
      showToast("success", "Produto criado.");
    } else if (productEditor) {
      setProducts((currentProducts) =>
        currentProducts.map((product) =>
          product.id === productEditor.id
            ? { ...product, name, category: productDraft.category, price, active: productDraft.active }
            : product,
        ),
      );
      showToast("success", "Produto atualizado.");
    }

    setProductEditor(null);
  };

  const deleteProduct = (product: Product) => {
    askConfirmation({
      title: "Excluir produto",
      message: `Deseja excluir ${product.name}? O histórico de comandas fechadas será preservado.`,
      confirmLabel: "Excluir",
      danger: true,
      onConfirm: async () => {
        const cloudDeleted = await runCloudDelete(
          (session) => deleteCloudProduct(session, product.id),
          "Não apaguei o produto na nuvem",
        );
        if (!cloudDeleted) return;

        setProducts((currentProducts) => currentProducts.filter((item) => item.id !== product.id));
        setPromotions((currentPromotions) =>
          currentPromotions.filter((promotion) => promotion.productId !== product.id),
        );
        showToast("success", "Produto excluído.");
      },
    });
  };

  const toggleProductStatus = (productId: string) => {
    setProducts((currentProducts) =>
      currentProducts.map((product) =>
        product.id === productId ? { ...product, active: !product.active } : product,
      ),
    );
  };

  const openPromotionEditor = (promotion: Promotion | "new") => {
    setPromotionEditor(promotion);

    if (promotion === "new") {
      setPromotionDraft(createEmptyPromotionDraft(products[0]?.id ?? ""));
      return;
    }

    const today = getLocalDateInput();
    setPromotionDraft({
      productId: promotion.productId,
      promotionalPrice: promotion.promotionalPrice,
      name: promotion.name ?? "",
      startDate: promotion.startDate,
      endDate: promotion.endDate,
      onlyToday: promotion.startDate === today && promotion.endDate === today,
      active: promotion.active,
    });
  };

  const hasConflictingPromotion = (draft: PromotionDraft, editingId?: string) =>
    draft.active &&
    promotions.some(
      (promotion) =>
        promotion.id !== editingId &&
        promotion.productId === draft.productId &&
        promotion.active &&
        getPromotionStatus(promotion) !== "Encerrada" &&
        dateRangesOverlap(draft.startDate, draft.endDate, promotion.startDate, promotion.endDate),
    );

  const savePromotion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const product = productsById.get(promotionDraft.productId);
    const today = getLocalDateInput();
    const startDate = promotionDraft.onlyToday ? today : promotionDraft.startDate;
    const endDate = promotionDraft.onlyToday ? today : promotionDraft.endDate;
    const promotionalPrice = Math.max(0, promotionDraft.promotionalPrice);
    const editingId = promotionEditor !== "new" ? promotionEditor?.id : undefined;
    const draftToValidate = { ...promotionDraft, startDate, endDate, promotionalPrice };

    if (!product) {
      showToast("error", "Escolha um produto para a promoção.");
      return;
    }

    if (product.price <= 0) {
      showToast("error", "O produto precisa ter preço normal maior que zero.");
      return;
    }

    if (promotionalPrice <= 0) {
      showToast("error", "Informe um preço promocional maior que zero.");
      return;
    }

    if (promotionalPrice >= product.price) {
      showToast("error", "O preço promocional precisa ser menor que o preço normal.");
      return;
    }

    if (!startDate || !endDate || startDate > endDate) {
      showToast("error", "Confira as datas da promoção.");
      return;
    }

    if (hasConflictingPromotion(draftToValidate, editingId)) {
      showToast("error", "Esse produto já tem promoção ativa nesse período.");
      return;
    }

    const now = new Date().toISOString();

    if (promotionEditor === "new") {
      const newPromotion: Promotion = {
        id: createId("promocao"),
        productId: product.id,
        name: promotionDraft.name.trim() || undefined,
        promotionalPrice,
        startDate,
        endDate,
        active: promotionDraft.active,
        createdAt: now,
        updatedAt: now,
      };

      setPromotions((currentPromotions) => [newPromotion, ...currentPromotions]);
      showToast("success", "Promoção criada.");
    } else if (promotionEditor) {
      setPromotions((currentPromotions) =>
        currentPromotions.map((promotion) =>
          promotion.id === promotionEditor.id
            ? {
                ...promotion,
                productId: product.id,
                name: promotionDraft.name.trim() || undefined,
                promotionalPrice,
                startDate,
                endDate,
                active: promotionDraft.active,
                updatedAt: now,
              }
            : promotion,
        ),
      );
      showToast("success", "Promoção atualizada.");
    }

    setPromotionEditor(null);
  };

  const togglePromotionStatus = (promotion: Promotion) => {
    const nextActive = !promotion.active;

    if (
      nextActive &&
      hasConflictingPromotion(
        {
          productId: promotion.productId,
          promotionalPrice: promotion.promotionalPrice,
          name: promotion.name ?? "",
          startDate: promotion.startDate,
          endDate: promotion.endDate,
          onlyToday: false,
          active: true,
        },
        promotion.id,
      )
    ) {
      showToast("error", "Esse produto já tem promoção ativa nesse período.");
      return;
    }

    setPromotions((currentPromotions) =>
      currentPromotions.map((item) =>
        item.id === promotion.id ? { ...item, active: nextActive, updatedAt: new Date().toISOString() } : item,
      ),
    );
    showToast("success", nextActive ? "Promoção ativada." : "Promoção desativada.");
  };

  const deletePromotion = (promotion: Promotion) => {
    const product = productsById.get(promotion.productId);

    askConfirmation({
      title: "Excluir promoção",
      message: `Deseja excluir a promoção de ${product?.name ?? "produto removido"}?`,
      confirmLabel: "Excluir",
      danger: true,
      onConfirm: async () => {
        const cloudDeleted = await runCloudDelete(
          (session) => deleteCloudPromotion(session, promotion.id),
          "Não apaguei a promoção na nuvem",
        );
        if (!cloudDeleted) return;

        setPromotions((currentPromotions) => currentPromotions.filter((item) => item.id !== promotion.id));
        showToast("success", "Promoção excluída.");
      },
    });
  };

  const deleteHistoryOrder = (order: Order) => {
    askConfirmation({
      title: "Excluir do histórico",
      message: `Deseja excluir a comanda ${order.table} do histórico e do caixa?`,
      confirmLabel: "Excluir",
      danger: true,
      onConfirm: async () => {
        if (!cashierSession) {
          showToast("error", "Conecte o caixa antes de apagar, para excluir nos dois apps.");
          return;
        }

        try {
          const result = await deleteCashierEntryForOrder(order, cashierSession);
          setCashierSession(result.session);
        } catch (error) {
          showToast("error", `Não apaguei a comanda porque o caixa não confirmou: ${getCashierErrorMessage(error)}`);
          return;
        }

        const cloudDeleted = await runCloudDelete(
          (session) => deleteCloudOrder(session, order.id),
          "Não apaguei a comanda na nuvem",
        );
        if (!cloudDeleted) return;

        rememberDeletedOrderIds(cashierSession.userId, [order.id]);
        setHistory((orders) => orders.filter((item) => item.id !== order.id));
        setSelectedHistoryId(null);
        showToast("success", "Comanda excluída do histórico e do caixa.");
      },
    });
  };

  const renderContent = () => {
    if (selectedOrder) {
      return (
        <OrderDetails
          order={selectedOrder}
          totals={calculateOrderTotals(selectedOrder)}
          onBack={() => setSelectedOrderId(null)}
          onAddItem={() => setShowAddItem(true)}
          onChangeItemQuantity={changeItemQuantity}
          onAskRemoveItem={(item) =>
            askConfirmation({
              title: "Remover item",
              message: `Deseja remover ${item.productName} da comanda?`,
              confirmLabel: "Remover",
              danger: true,
              onConfirm: () => removeItem(item.id),
            })
          }
          onCloseOrder={openCloseOrder}
          onDeleteOrder={() => deleteOpenOrder(selectedOrder)}
        />
      );
    }

    if (selectedHistory) {
      return (
        <HistoryDetails
          order={selectedHistory}
          onBack={() => setSelectedHistoryId(null)}
          onDelete={() => deleteHistoryOrder(selectedHistory)}
        />
      );
    }

    switch (activeTab) {
      case "products":
        return (
          <ProductsScreen
            activeSection={productAreaTab}
            products={filteredProducts}
            allProducts={products}
            promotions={filteredPromotions}
            totalPromotions={promotions.length}
            search={searchProducts}
            promotionSearch={searchPromotions}
            promotionFilter={promotionFilter}
            onSectionChange={setProductAreaTab}
            onSearch={setSearchProducts}
            onPromotionSearch={setSearchPromotions}
            onPromotionFilter={setPromotionFilter}
            onCreate={() => openProductEditor("new")}
            onEdit={openProductEditor}
            onDelete={deleteProduct}
            onToggleStatus={toggleProductStatus}
            onCreatePromotion={() => openPromotionEditor("new")}
            onEditPromotion={openPromotionEditor}
            onTogglePromotion={togglePromotionStatus}
            onDeletePromotion={deletePromotion}
          />
        );
      case "history":
        return (
          <HistoryScreen
            history={filteredHistory}
            search={searchHistory}
            dateFilter={historyDateFilter}
            paymentFilter={historyPaymentFilter}
            onSearch={setSearchHistory}
            onDateFilter={setHistoryDateFilter}
            onPaymentFilter={setHistoryPaymentFilter}
            onOpen={setSelectedHistoryId}
            onDelete={deleteHistoryOrder}
          />
        );
      default:
        return (
          <OrdersScreen
            orders={filteredOpenOrders}
            search={searchOrders}
            onSearch={setSearchOrders}
            onNewOrder={() => setShowNewOrder(true)}
            onOpenOrder={setSelectedOrderId}
            onDeleteOrder={deleteOpenOrder}
          />
        );
    }
  };

  if (!cashierSession) {
    return (
      <div className="app-shell auth-shell">
        <main className="auth-main">
          <LoginScreen
            login={cashierLogin}
            connecting={cashierConnecting}
            onLoginChange={setCashierLogin}
            onSubmit={connectCashier}
          />
        </main>

        {toast && (
          <div className={`toast toast-${toast.kind}`} role="status">
            {toast.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <AccountBar session={cashierSession} onLogout={disconnectCashier} />
        {renderContent()}
      </main>

      {!selectedOrder && !selectedHistory && (
        <BottomNav
          activeTab={activeTab}
          onChange={(tab) => {
            setActiveTab(tab);
            setSelectedOrderId(null);
            setSelectedHistoryId(null);
          }}
        />
      )}

      {showNewOrder && (
        <Modal title="Nova Comanda" onClose={() => setShowNewOrder(false)}>
          <form
            className="form-stack"
            onSubmit={createOrder}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.requestSubmit();
              }
            }}
          >
            <label>
              <span className="label-row">
                Mesa <span className="label-hint">opcional</span>
              </span>
              <select name="table" autoFocus defaultValue="">
                <option value="">Sem mesa</option>
                {tableOptions.map((tableOption) => (
                  <option key={tableOption} value={tableOption}>
                    {tableOption}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nome do cliente
              <input name="customer" placeholder="Nome do cliente" required />
            </label>
            <button className="primary-action" type="submit">
              <Plus size={22} />
              Abrir Comanda
            </button>
          </form>
        </Modal>
      )}

      {showAddItem && selectedOrder && (
        <AddItemModal
          products={activeProducts}
          promotions={promotions}
          selectedProduct={productToAdd}
          quantity={quantityToAdd}
          note={itemNote}
          onClose={() => {
            setShowAddItem(false);
            setProductToAdd(null);
            setQuantityToAdd(1);
            setItemNote("");
          }}
          onSelectProduct={setProductToAdd}
          onQuantityChange={setQuantityToAdd}
          onNoteChange={setItemNote}
          onConfirm={confirmAddProduct}
        />
      )}

      {showCloseOrder && selectedOrder && currentOrderTotals && (
        <CloseOrderModal
          order={selectedOrder}
          method={paymentMethod}
          cashierSession={cashierSession}
          cashierLogin={cashierLogin}
          cashierConnecting={cashierConnecting}
          closingPayment={closingPayment}
          onClose={() => setShowCloseOrder(false)}
          onMethodChange={setPaymentMethod}
          onCashierLoginChange={setCashierLogin}
          onCashierConnect={connectCashier}
          onCashierDisconnect={disconnectCashier}
          onConfirm={confirmPayment}
        />
      )}

      {productEditor && (
        <ProductEditorModal
          draft={productDraft}
          isEditing={productEditor !== "new"}
          onDraftChange={setProductDraft}
          onSubmit={saveProduct}
          onClose={() => setProductEditor(null)}
        />
      )}

      {promotionEditor && (
        <PromotionEditorModal
          draft={promotionDraft}
          products={products}
          isEditing={promotionEditor !== "new"}
          onDraftChange={setPromotionDraft}
          onSubmit={savePromotion}
          onClose={() => setPromotionEditor(null)}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          dialog={confirmDialog}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
        />
      )}

      {paymentDone && (
        <Modal title="Pagamento concluído" onClose={() => setPaymentDone(null)}>
          <div className="success-panel">
            <span className="success-icon">
              <BadgeCheck size={34} />
            </span>
            <h2>Comanda fechada com sucesso!</h2>
            <p>
              A comanda {getOrderTitle(paymentDone)} entrou para o histórico no clima da casa, com total de{" "}
              <strong>{formatCurrency(paymentDone.payment?.totalPaid ?? 0)}</strong>.
            </p>
            <button
              className="primary-action"
              onClick={() => {
                setPaymentDone(null);
                setActiveTab("history");
              }}
            >
              Ver histórico
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}

interface LoginScreenProps {
  login: CashierLoginDraft;
  connecting: boolean;
  onLoginChange: (draft: CashierLoginDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function LoginScreen({ login, connecting, onLoginChange, onSubmit }: LoginScreenProps) {
  return (
    <section className="login-screen">
      <div className="login-card">
        <img src={LOGO_SRC} alt="Adega Tá no Grale" className="login-logo" />
        <span className="eyebrow">Sistema de comandas</span>
        <h1>Adega Tá no Grale</h1>
        <p>Entre com o mesmo usuário e PIN do app Adega Caixa.</p>

        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Usuário
            <div className="login-input">
              <UserRound size={20} />
              <input
                value={login.username}
                onChange={(event) => onLoginChange({ ...login, username: event.target.value })}
                placeholder="Usuário do caixa"
                autoComplete="username"
                autoFocus
              />
            </div>
          </label>
          <label>
            PIN
            <div className="login-input">
              <KeyRound size={20} />
              <input
                value={login.pin}
                onChange={(event) => onLoginChange({ ...login, pin: event.target.value.replace(/\D/g, "").slice(0, 4) })}
                placeholder="4 números"
                inputMode="numeric"
                type="password"
                autoComplete="current-password"
              />
            </div>
          </label>

          <button className="primary-action" type="submit" disabled={connecting}>
            <Link2 size={22} />
            {connecting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </section>
  );
}

interface AccountBarProps {
  session: CashierSession;
  onLogout: () => void;
}

function AccountBar({ session, onLogout }: AccountBarProps) {
  return (
    <div className="account-bar">
      <span>
        <UserRound size={18} />
        {session.username}
      </span>
      <button type="button" onClick={onLogout}>
        <LogOut size={17} />
        Sair
      </button>
    </div>
  );
}

interface OrdersScreenProps {
  orders: Order[];
  search: string;
  onSearch: (value: string) => void;
  onNewOrder: () => void;
  onOpenOrder: (orderId: string) => void;
  onDeleteOrder: (order: Order) => void;
}

function OrdersScreen({ orders, search, onSearch, onNewOrder, onOpenOrder, onDeleteOrder }: OrdersScreenProps) {
  return (
    <section className="screen home-screen">
      <header className="brand-hero">
        <div className="brand-lockup">
          <img src={LOGO_SRC} alt="Adega Tá no Grale" className="brand-logo" />
          <div>
            <h1>Sistema de Comandas</h1>
            <p>Atendimento ágil, gelado e no ponto.</p>
          </div>
        </div>
        <div className="hero-stats">
          <Snowflake size={18} />
          <span>Comandas abertas</span>
          <strong>{orders.length}</strong>
        </div>
      </header>

      <button className="primary-action hero-action" onClick={onNewOrder}>
        <Plus size={26} />
        Nova Comanda
      </button>

      <SearchField value={search} onChange={onSearch} placeholder="Pesquisar por mesa ou cliente" />

      <div className="section-title">
        <h2>Comandas abertas</h2>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nenhuma comanda aberta"
          text="Abra uma nova comanda para começar o atendimento."
        />
      ) : (
        <div className="card-list">
          {orders.map((order) => {
            const totals = calculateOrderTotals(order);

            return (
              <article className="order-card" key={order.id}>
                <button className="order-card-open" onClick={() => onOpenOrder(order.id)}>
                <div className="card-row">
                  <div>
                    <span className="status-pill">Aberta</span>
                    <h3>{getOrderTitle(order)}</h3>
                    {shouldShowCustomer(order) && <p>{order.customer}</p>}
                  </div>
                  <ChevronRight size={22} />
                </div>
                <div className="order-meta">
                  <span>
                    <Clock3 size={16} />
                    {formatTime(order.openedAt)}
                  </span>
                  <span>{totals.itemsCount} itens</span>
                  <strong>{formatCurrency(totals.subtotal)}</strong>
                </div>
                </button>
                <button
                  className="order-card-trash"
                  onClick={() => onDeleteOrder(order)}
                  aria-label={`Excluir comanda ${getOrderTitle(order)}`}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface OrderDetailsProps {
  order: Order;
  totals: ReturnType<typeof calculateOrderTotals>;
  onBack: () => void;
  onAddItem: () => void;
  onChangeItemQuantity: (itemId: string, delta: number) => void;
  onAskRemoveItem: (item: OrderItem) => void;
  onCloseOrder: () => void;
  onDeleteOrder: () => void;
}

function OrderDetails({
  order,
  totals,
  onBack,
  onAddItem,
  onChangeItemQuantity,
  onAskRemoveItem,
  onCloseOrder,
  onDeleteOrder,
}: OrderDetailsProps) {
  return (
    <section className="screen detail-screen">
      <header className="detail-header command-header">
        <button className="icon-button" onClick={onBack} aria-label="Voltar">
          <ArrowLeft size={24} />
        </button>
        <div className="command-heading">
          <div className="mini-brand">
            <img src={LOGO_SRC} alt="Adega Tá no Grale" />
            <span>Comanda</span>
          </div>
          <span className="status-pill">Aberta</span>
          <h1>{getOrderTitle(order)}</h1>
          {shouldShowCustomer(order) && <p>{order.customer}</p>}
          <small>Aberta em {formatDateTime(order.openedAt)}</small>
        </div>
        <div className="floating-total">
          <span>Total</span>
          <strong>{formatCurrency(totals.total)}</strong>
        </div>
        <button className="danger-icon" onClick={onDeleteOrder} aria-label="Excluir comanda">
          <Trash2 size={20} />
        </button>
      </header>

      <div className="detail-actions-row">
        <button className="whatsapp-action" onClick={() => shareOrderOnWhatsApp(order)}>
          <MessageCircle size={21} />
          Compartilhar no WhatsApp
        </button>
      </div>

      <button className="primary-action hero-action" onClick={onAddItem}>
        <Plus size={24} />
        Adicionar item
      </button>

      <div className="section-title">
        <h2>Itens da comanda</h2>
        <span>{totals.itemsCount}</span>
      </div>

      {order.items.length === 0 ? (
        <EmptyState icon={Package} title="Nenhum item adicionado" text="Toque em Adicionar item para montar a comanda." />
      ) : (
        <div className="item-list">
          {order.items.map((item) => (
            <article className="item-card" key={item.id}>
              <div>
                <span className={`category-pill ${categoryVisuals[item.category].className}`}>
                  {item.category}
                </span>
                {isPromotionalItem(item) && <span className="promo-tag item-promo-tag">{item.promotion?.name || "PROMOÇÃO"}</span>}
                <h3>{item.productName}</h3>
                {isPromotionalItem(item) ? (
                  <p className="item-price-line">
                    {item.quantity} x <s>{formatCurrency(item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice)}</s>{" "}
                    <strong>{formatCurrency(item.unitPrice)}</strong>
                  </p>
                ) : (
                  <p>
                    {item.quantity} x {formatCurrency(item.unitPrice)}
                  </p>
                )}
                {item.note && <small className="note-tag">Obs: {item.note}</small>}
              </div>
              <div className="item-actions">
                <strong>{formatCurrency(item.unitPrice * item.quantity)}</strong>
                <div className="quantity-control">
                  <button onClick={() => onChangeItemQuantity(item.id, -1)} aria-label="Diminuir quantidade">
                    <Minus size={18} />
                  </button>
                  <span>{item.quantity}</span>
                  <button onClick={() => onChangeItemQuantity(item.id, 1)} aria-label="Aumentar quantidade">
                    <Plus size={18} />
                  </button>
                </div>
                <button className="danger-icon" onClick={() => onAskRemoveItem(item)} aria-label="Remover item">
                  <Trash2 size={19} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="checkout-bar">
        <SummaryLine label="Subtotal" value={formatCurrency(totals.subtotal)} />
        <SummaryLine label="Total final" value={formatCurrency(totals.total)} strong />
        <button className="primary-action close-action" onClick={onCloseOrder}>
          <CircleDollarSign size={23} />
          Fechar Comanda
        </button>
      </footer>
    </section>
  );
}

interface AddItemModalProps {
  products: Product[];
  promotions: Promotion[];
  selectedProduct: Product | null;
  quantity: number;
  note: string;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  onQuantityChange: (value: number) => void;
  onNoteChange: (value: string) => void;
  onConfirm: () => void;
}

function AddItemModal({
  products,
  promotions,
  selectedProduct,
  quantity,
  note,
  onClose,
  onSelectProduct,
  onQuantityChange,
  onNoteChange,
  onConfirm,
}: AddItemModalProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeText(query);
  const visibleProducts = products.filter((product) => !normalizedQuery || normalizeText(product.name).includes(normalizedQuery));
  const visibleCategoryGroups = CATEGORIES.map((category) => ({
    category,
    products: visibleProducts.filter((product) => product.category === category),
    visual: categoryVisuals[category],
  })).filter((group) => group.products.length > 0);

  if (selectedProduct) {
    const selectedCategoryVisual = categoryVisuals[selectedProduct.category];
    const SelectedCategoryIcon = selectedCategoryVisual.icon;
    const selectedPromotion = getApplicablePromotionForProduct(selectedProduct, promotions);

    return (
      <Modal title="Adicionar produto" onClose={onClose}>
        <div className={`selected-product ${selectedCategoryVisual.className}`}>
          <span>
            <SelectedCategoryIcon size={19} />
            {selectedProduct.category}
          </span>
          <h2>{selectedProduct.name}</h2>
          {selectedPromotion ? (
            <div className="promo-price-stack">
              <span className="promo-tag">{getPromotionTagText(selectedPromotion)}</span>
              <s>{formatCurrency(selectedProduct.price)}</s>
              <strong>{formatCurrency(selectedPromotion.promotionalPrice)}</strong>
            </div>
          ) : (
            <strong>{formatCurrency(selectedProduct.price)}</strong>
          )}
        </div>
        <div className="form-stack">
          <label>
            Quantidade
            <div className="quantity-control large">
              <button onClick={() => onQuantityChange(Math.max(1, quantity - 1))} type="button">
                <Minus size={20} />
              </button>
              <span>{quantity}</span>
              <button onClick={() => onQuantityChange(quantity + 1)} type="button">
                <Plus size={20} />
              </button>
            </div>
          </label>
          <label>
            Observação
            <textarea
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="sem cebola, sem gelo, bem passado..."
            />
          </label>
          <button className="primary-action" type="button" onClick={onConfirm}>
            <Check size={22} />
            Confirmar adição
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Adicionar item" onClose={onClose} wide>
      <SearchField value={query} onChange={setQuery} placeholder="Buscar produto" />
      {visibleCategoryGroups.length === 0 ? (
        <EmptyState
          icon={Package}
          title={products.length === 0 ? "Nenhum produto ativo" : "Nenhum produto encontrado"}
          text={products.length === 0 ? "Cadastre ou ative produtos antes de adicionar itens." : "Tente buscar por outro nome."}
        />
      ) : (
        <div className="category-groups">
          {visibleCategoryGroups.map(({ category, products: categoryProducts, visual }) => {
            const CategoryIcon = visual.icon;

            return (
            <section key={category} className={`category-group ${visual.className}`}>
              <h3>
                <span>
                  <CategoryIcon size={20} />
                </span>
                {category}
                <small>{visual.label}</small>
              </h3>
              <div className="product-pick-list">
                {categoryProducts.map((product) => {
                  const activePromotion = getApplicablePromotionForProduct(product, promotions);

                  return (
                    <button className={activePromotion ? "has-promo" : ""} key={product.id} onClick={() => onSelectProduct(product)}>
                      <span className="product-pick-name">
                        {activePromotion && <small className="promo-tag">PROMOÇÃO</small>}
                        {product.name}
                        {activePromotion?.name && <em>{activePromotion.name}</em>}
                      </span>
                      {activePromotion ? (
                        <span className="product-pick-price promo">
                          <s>{formatCurrency(product.price)}</s>
                          <strong>{formatCurrency(activePromotion.promotionalPrice)}</strong>
                        </span>
                      ) : (
                        <strong>{formatCurrency(product.price)}</strong>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

interface CloseOrderModalProps {
  order: Order;
  method: PaymentMethod;
  cashierSession: CashierSession | null;
  cashierLogin: CashierLoginDraft;
  cashierConnecting: boolean;
  closingPayment: boolean;
  onClose: () => void;
  onMethodChange: (method: PaymentMethod) => void;
  onCashierLoginChange: (draft: CashierLoginDraft) => void;
  onCashierConnect: (event: FormEvent<HTMLFormElement>) => void;
  onCashierDisconnect: () => void;
  onConfirm: () => void;
}

function CloseOrderModal({
  order,
  method,
  cashierSession,
  cashierLogin,
  cashierConnecting,
  closingPayment,
  onClose,
  onMethodChange,
  onCashierLoginChange,
  onCashierConnect,
  onCashierDisconnect,
  onConfirm,
}: CloseOrderModalProps) {
  const totals = calculateOrderTotals(order);

  return (
    <Modal title="Fechar Comanda" onClose={onClose}>
      <div className="payment-summary">
        <span>
          <ReceiptText size={20} />
          {getOrderTitle(order)}
        </span>
        <strong>{formatCurrency(totals.total)}</strong>
        <small>{order.items.length} itens na comanda pronta para fechar</small>
      </div>

      <div className="payment-options">
        {paymentOptions.map(({ value, icon: Icon }) => (
          <button
            key={value}
            className={method === value ? "selected" : ""}
            onClick={() => onMethodChange(value)}
            type="button"
          >
            <Icon size={20} />
            {value}
          </button>
        ))}
      </div>

      <div className="form-stack">
        <SummaryLine label="Subtotal" value={formatCurrency(totals.subtotal)} />
        <SummaryLine label="Total da comanda" value={formatCurrency(totals.total)} strong />

        <CashierBridgePanel
          session={cashierSession}
          login={cashierLogin}
          connecting={cashierConnecting}
          onLoginChange={onCashierLoginChange}
          onConnect={onCashierConnect}
          onDisconnect={onCashierDisconnect}
        />

        <button className="primary-action" type="button" onClick={onConfirm} disabled={closingPayment}>
          <Check size={22} />
          {closingPayment ? "Enviando..." : "Confirmar pagamento"}
        </button>
      </div>
    </Modal>
  );
}

interface CashierBridgePanelProps {
  session: CashierSession | null;
  login: CashierLoginDraft;
  connecting: boolean;
  onLoginChange: (draft: CashierLoginDraft) => void;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  onDisconnect: () => void;
}

function CashierBridgePanel({
  session,
  login,
  connecting,
  onLoginChange,
  onConnect,
  onDisconnect,
}: CashierBridgePanelProps) {
  if (session) {
    return (
      <div className="cashier-bridge connected">
        <div>
          <span>
            <Link2 size={19} />
            Envio ao caixa
          </span>
          <strong>Conectado: {session.username}</strong>
          <small>Ao fechar, a comanda entra como venda no app Adega Caixa.</small>
        </div>
        <button type="button" onClick={onDisconnect}>
          <LogOut size={18} />
          Desconectar
        </button>
      </div>
    );
  }

  return (
    <form className="cashier-bridge" onSubmit={onConnect}>
      <div>
        <span>
          <Link2 size={19} />
          Envio ao caixa
        </span>
        <small>Conecte com o mesmo usuário e PIN do app Adega Caixa.</small>
      </div>
      <div className="cashier-login-grid">
        <input
          value={login.username}
          onChange={(event) => onLoginChange({ ...login, username: event.target.value })}
          placeholder="Usuário do caixa"
          autoComplete="username"
        />
        <input
          value={login.pin}
          onChange={(event) => onLoginChange({ ...login, pin: event.target.value.replace(/\D/g, "").slice(0, 4) })}
          placeholder="PIN"
          inputMode="numeric"
          type="password"
          autoComplete="current-password"
        />
        <button type="submit" disabled={connecting}>
          {connecting ? "Conectando..." : "Conectar"}
        </button>
      </div>
    </form>
  );
}

interface ProductsScreenProps {
  activeSection: ProductAreaTab;
  products: Product[];
  allProducts: Product[];
  promotions: Promotion[];
  totalPromotions: number;
  search: string;
  promotionSearch: string;
  promotionFilter: PromotionFilter;
  onSectionChange: (section: ProductAreaTab) => void;
  onSearch: (value: string) => void;
  onPromotionSearch: (value: string) => void;
  onPromotionFilter: (value: PromotionFilter) => void;
  onCreate: () => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onToggleStatus: (productId: string) => void;
  onCreatePromotion: () => void;
  onEditPromotion: (promotion: Promotion) => void;
  onTogglePromotion: (promotion: Promotion) => void;
  onDeletePromotion: (promotion: Promotion) => void;
}

function ProductsScreen({
  activeSection,
  products,
  allProducts,
  promotions,
  totalPromotions,
  search,
  promotionSearch,
  promotionFilter,
  onSectionChange,
  onSearch,
  onPromotionSearch,
  onPromotionFilter,
  onCreate,
  onEdit,
  onDelete,
  onToggleStatus,
  onCreatePromotion,
  onEditPromotion,
  onTogglePromotion,
  onDeletePromotion,
}: ProductsScreenProps) {
  const productById = new Map(allProducts.map((product) => [product.id, product]));
  return (
    <section className="screen">
      <header className="topbar inner-topbar">
        <div className="screen-heading">
          <img src={LOGO_SRC} alt="Adega Tá no Grale" className="header-logo" />
          <div>
          <span className="eyebrow">{activeSection === "products" ? "Cadastro" : "Ofertas"}</span>
          <h1>{activeSection === "products" ? "Produtos" : "Promoções"}</h1>
          </div>
        </div>
        {activeSection === "products" ? (
          <button className="primary-small" onClick={onCreate}>
            <Plus size={20} />
            Produto
          </button>
        ) : (
          <button className="primary-small" onClick={onCreatePromotion}>
            <Plus size={20} />
            Nova promoção
          </button>
        )}
      </header>

      <div className="product-area-tabs" role="tablist" aria-label="Produtos e promoções">
        <button className={activeSection === "products" ? "active" : ""} onClick={() => onSectionChange("products")}>
          <Package size={19} />
          Produtos
        </button>
        <button className={activeSection === "promotions" ? "active" : ""} onClick={() => onSectionChange("promotions")}>
          <Tag size={19} />
          Promoções
        </button>
      </div>

      {activeSection === "products" ? (
        <>
      <SearchField value={search} onChange={onSearch} placeholder="Buscar produto" />

      {products.length === 0 ? (
        <EmptyState icon={Package} title="Nenhum produto encontrado" text="Cadastre seus produtos para comecar a montar as comandas." />
      ) : (
        <div className="product-grid">
          {products.map((product) => {
            const visual = categoryVisuals[product.category];
            const CategoryIcon = visual.icon;

            return (
            <article className={`product-card ${visual.className} ${!product.active ? "inactive" : ""}`} key={product.id}>
              <div>
                <span className={`category-pill ${visual.className}`}>
                  <CategoryIcon size={16} />
                  {product.category}
                </span>
                <h3>{product.name}</h3>
                <strong>{formatCurrency(product.price)}</strong>
                <p>{product.active ? "Ativo" : "Inativo"}</p>
              </div>
              <div className="product-actions">
                <button onClick={() => onToggleStatus(product.id)}>{product.active ? "Desativar" : "Ativar"}</button>
                <button className="icon-button" onClick={() => onEdit(product)} aria-label="Editar produto">
                  <Edit3 size={19} />
                </button>
                <button className="danger-icon" onClick={() => onDelete(product)} aria-label="Excluir produto">
                  <Trash2 size={19} />
                </button>
              </div>
            </article>
            );
          })}
        </div>
      )}
        </>
      ) : (
        <>
          <SearchField value={promotionSearch} onChange={onPromotionSearch} placeholder="Buscar promoção por produto" />
          <div className="filter-row">
            {(["Todas", "Ativas", "Encerradas", "Agendadas"] as PromotionFilter[]).map((filter) => (
              <button key={filter} className={promotionFilter === filter ? "active" : ""} onClick={() => onPromotionFilter(filter)}>
                {filter}
              </button>
            ))}
          </div>

          {promotions.length === 0 ? (
            <EmptyState
              icon={Tag}
              title={totalPromotions === 0 ? "Nenhuma promoção cadastrada" : "Nenhuma promoção encontrada"}
              text={totalPromotions === 0 ? "Crie uma promoção para aplicar preço especial nos próximos itens adicionados." : "Tente outro produto ou filtro."}
            />
          ) : (
            <div className="promotion-grid">
              {promotions.map((promotion) => {
                const product = productById.get(promotion.productId);
                const status = getPromotionStatus(promotion);
                const economy = product ? Math.max(0, product.price - promotion.promotionalPrice) : 0;

                return (
                  <article className={`promotion-card status-${normalizeText(status)}`} key={promotion.id}>
                    <div className="promotion-card-head">
                      <span className="promo-tag">{status === "Ativa" ? "PROMOÇÃO" : status}</span>
                      <small>{status}</small>
                    </div>
                    <h3>{product?.name ?? "Produto removido"}</h3>
                    {promotion.name && <p>{promotion.name}</p>}
                    <div className="promotion-values">
                      <span>
                        Normal
                        <s>{product ? formatCurrency(product.price) : "-"}</s>
                      </span>
                      <strong>{formatCurrency(promotion.promotionalPrice)}</strong>
                    </div>
                    <div className="promotion-meta">
                      <span>Economia {formatCurrency(economy)}</span>
                      <span>
                        {formatDateOnly(promotion.startDate)} até {formatDateOnly(promotion.endDate)}
                      </span>
                    </div>
                    <div className="product-actions">
                      <button onClick={() => onTogglePromotion(promotion)}>{promotion.active ? "Desativar" : "Ativar"}</button>
                      <button className="icon-button" onClick={() => onEditPromotion(promotion)} aria-label="Editar promoção">
                        <Edit3 size={19} />
                      </button>
                      <button className="danger-icon" onClick={() => onDeletePromotion(promotion)} aria-label="Excluir promoção">
                        <Trash2 size={19} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface ProductEditorModalProps {
  draft: ProductDraft;
  isEditing: boolean;
  onDraftChange: (draft: ProductDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

function ProductEditorModal({ draft, isEditing, onDraftChange, onSubmit, onClose }: ProductEditorModalProps) {
  return (
    <Modal title={isEditing ? "Editar produto" : "Novo produto"} onClose={onClose}>
      <form className="form-stack" onSubmit={onSubmit}>
        <label>
          Nome
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            placeholder="Nome do produto"
            required
          />
        </label>
        <label>
          Categoria
          <select
            value={draft.category}
            onChange={(event) => onDraftChange({ ...draft, category: event.target.value as Category })}
          >
            {CATEGORIES.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label>
          Preço
          <input
            inputMode="numeric"
            value={formatCurrencyInput(draft.price)}
            onChange={(event) => onDraftChange({ ...draft, price: parseCurrencyInput(event.target.value) })}
            placeholder="0,00"
          />
        </label>
        <label className="switch-row">
          <span>Produto ativo</span>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => onDraftChange({ ...draft, active: event.target.checked })}
          />
        </label>
        <button className="primary-action" type="submit">
          <Save size={22} />
          Salvar produto
        </button>
      </form>
    </Modal>
  );
}

interface PromotionEditorModalProps {
  draft: PromotionDraft;
  products: Product[];
  isEditing: boolean;
  onDraftChange: (draft: PromotionDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

function PromotionEditorModal({ draft, products, isEditing, onDraftChange, onSubmit, onClose }: PromotionEditorModalProps) {
  const selectedProduct = products.find((product) => product.id === draft.productId);
  const today = getLocalDateInput();
  const updateDraft = (nextDraft: PromotionDraft) => {
    onDraftChange(
      nextDraft.onlyToday
        ? { ...nextDraft, startDate: today, endDate: today }
        : nextDraft,
    );
  };

  return (
    <Modal title={isEditing ? "Editar promoção" : "Nova promoção"} onClose={onClose}>
      <form className="form-stack" onSubmit={onSubmit}>
        <label>
          Produto
          <select
            value={draft.productId}
            onChange={(event) => updateDraft({ ...draft, productId: event.target.value })}
            required
            disabled={products.length === 0}
          >
            {products.length === 0 ? (
              <option value="">Cadastre um produto primeiro</option>
            ) : (
              products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))
            )}
          </select>
        </label>

        <div className="normal-price-preview">
          <span>Preço normal</span>
          <strong>{selectedProduct ? formatCurrency(selectedProduct.price) : "R$ 0,00"}</strong>
        </div>

        <label>
          Preço promocional
          <input
            inputMode="numeric"
            value={formatCurrencyInput(draft.promotionalPrice)}
            onChange={(event) => updateDraft({ ...draft, promotionalPrice: parseCurrencyInput(event.target.value) })}
            placeholder="0,00"
            required
          />
        </label>

        <label>
          Nome ou motivo da promoção
          <input
            value={draft.name}
            onChange={(event) => updateDraft({ ...draft, name: event.target.value })}
            placeholder="Promoção do dia, Happy hour, Combo..."
          />
        </label>

        <label className="switch-row">
          <span>Somente hoje</span>
          <input
            type="checkbox"
            checked={draft.onlyToday}
            onChange={(event) =>
              updateDraft({
                ...draft,
                onlyToday: event.target.checked,
                startDate: event.target.checked ? today : draft.startDate,
                endDate: event.target.checked ? today : draft.endDate,
              })
            }
          />
        </label>

        <div className="date-pair">
          <label>
            Data de início
            <input
              type="date"
              value={draft.startDate}
              onChange={(event) => updateDraft({ ...draft, startDate: event.target.value })}
              disabled={draft.onlyToday}
              required
            />
          </label>
          <label>
            Data de término
            <input
              type="date"
              value={draft.endDate}
              onChange={(event) => updateDraft({ ...draft, endDate: event.target.value })}
              disabled={draft.onlyToday}
              required
            />
          </label>
        </div>

        <label className="switch-row">
          <span>Status ativo</span>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => updateDraft({ ...draft, active: event.target.checked })}
          />
        </label>

        <button className="primary-action" type="submit">
          <Save size={22} />
          Salvar promoção
        </button>
      </form>
    </Modal>
  );
}

interface HistoryScreenProps {
  history: Order[];
  search: string;
  dateFilter: string;
  paymentFilter: PaymentMethod | "Todos";
  onSearch: (value: string) => void;
  onDateFilter: (value: string) => void;
  onPaymentFilter: (value: PaymentMethod | "Todos") => void;
  onOpen: (orderId: string) => void;
  onDelete: (order: Order) => void;
}

function HistoryScreen({
  history,
  search,
  dateFilter,
  paymentFilter,
  onSearch,
  onDateFilter,
  onPaymentFilter,
  onOpen,
  onDelete,
}: HistoryScreenProps) {
  return (
    <section className="screen">
      <header className="topbar inner-topbar">
        <div className="screen-heading">
          <img src={LOGO_SRC} alt="Adega Tá no Grale" className="header-logo" />
          <div>
          <span className="eyebrow">Fechadas</span>
          <h1>Histórico</h1>
          </div>
        </div>
      </header>

      <SearchField value={search} onChange={onSearch} placeholder="Pesquisar por mesa ou cliente" />

      <div className="date-filter-row">
        <label className="date-filter">
          <CalendarDays size={21} />
          <span>Dia</span>
          <input type="date" value={dateFilter} onChange={(event) => onDateFilter(event.target.value)} />
        </label>
        {dateFilter && (
          <button className="clear-date-button" type="button" onClick={() => onDateFilter("")}>
            Todos os dias
          </button>
        )}
      </div>

      <div className="filter-row">
        {(["Todos", ...paymentOptions.map((option) => option.value)] as Array<PaymentMethod | "Todos">).map((method) => (
          <button
            key={method}
            className={paymentFilter === method ? "active" : ""}
            onClick={() => onPaymentFilter(method)}
          >
            {method}
          </button>
        ))}
      </div>

      {history.length === 0 ? (
        <EmptyState icon={Clock3} title="Nenhuma comanda fechada" text="As comandas pagas aparecerão aqui." />
      ) : (
        <div className="card-list">
          {history.map((order) => (
            <article className="history-card" key={order.id}>
              <button onClick={() => onOpen(order.id)}>
                <div>
                  <span className="status-pill closed">Fechada</span>
                  <h3>{getOrderTitle(order)}</h3>
                  <p>{shouldShowCustomer(order) ? order.customer : "Sem mesa definida"}</p>
                  <small>{formatDateTime(order.closedAt)}</small>
                </div>
                <div>
                  <strong>{formatCurrency(order.payment?.totalPaid ?? 0)}</strong>
                  <span>{order.payment?.method}</span>
                </div>
              </button>
              <button className="danger-icon" onClick={() => onDelete(order)} aria-label="Excluir do histórico">
                <Trash2 size={19} />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

interface HistoryDetailsProps {
  order: Order;
  onBack: () => void;
  onDelete: () => void;
}

function HistoryDetails({ order, onBack, onDelete }: HistoryDetailsProps) {
  const totals = calculateOrderTotals(order);
  const promotionalItems = order.items.filter(isPromotionalItem);

  return (
    <section className="screen detail-screen">
      <header className="detail-header command-header">
        <button className="icon-button" onClick={onBack} aria-label="Voltar">
          <ArrowLeft size={24} />
        </button>
        <div className="command-heading">
          <div className="mini-brand">
            <img src={LOGO_SRC} alt="Adega Tá no Grale" />
            <span>Histórico</span>
          </div>
          <span className="status-pill closed">Fechada</span>
          <h1>{getOrderTitle(order)}</h1>
          {shouldShowCustomer(order) && <p>{order.customer}</p>}
          <small>Fechada em {formatDateTime(order.closedAt)}</small>
        </div>
        <button className="danger-icon" onClick={onDelete} aria-label="Excluir comanda fechada">
          <Trash2 size={20} />
        </button>
      </header>

      <div className="detail-actions-row">
        <button className="whatsapp-action" onClick={() => shareOrderOnWhatsApp(order)}>
          <MessageCircle size={21} />
          Compartilhar no WhatsApp
        </button>
      </div>

      <div className="item-list">
        {order.items.map((item) => (
          <article className="item-card compact" key={item.id}>
            <div>
              <h3>{item.productName}</h3>
              {isPromotionalItem(item) && <span className="promo-tag item-promo-tag">{item.promotion?.name || "PROMOÇÃO"}</span>}
              {isPromotionalItem(item) ? (
                <p className="item-price-line">
                  {item.quantity} x <s>{formatCurrency(item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice)}</s>{" "}
                  <strong>{formatCurrency(item.unitPrice)}</strong>
                </p>
              ) : (
                <p>
                  {item.quantity} x {formatCurrency(item.unitPrice)}
                </p>
              )}
              {item.note && <small className="note-tag">Obs: {item.note}</small>}
            </div>
            <strong>{formatCurrency(item.quantity * item.unitPrice)}</strong>
          </article>
        ))}
      </div>

      {promotionalItems.length > 0 && (
        <section className="promo-history-panel">
          <h2>Promoções aplicadas</h2>
          <div>
            {promotionalItems.map((item) => (
              <article key={item.id}>
                <strong>{item.productName}</strong>
                <span>Preço normal: {formatCurrency(item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice)}</span>
                <span>Preço promocional: {formatCurrency(item.unitPrice)}</span>
                {item.promotion?.name && <span>Motivo: {item.promotion.name}</span>}
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="checkout-bar static">
        <SummaryLine label="Pagamento" value={order.payment?.method ?? "-"} />
        <SummaryLine label="Subtotal" value={formatCurrency(totals.subtotal)} />
        <SummaryLine label="Total pago" value={formatCurrency(order.payment?.totalPaid ?? totals.total)} strong />
      </div>
    </section>
  );
}

interface BottomNavProps {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

function BottomNav({ activeTab, onChange }: BottomNavProps) {
  const tabs: Array<{ id: Tab; label: string; icon: typeof ClipboardList }> = [
    { id: "orders", label: "Comandas", icon: ClipboardList },
    { id: "products", label: "Produtos", icon: Package },
    { id: "history", label: "Histórico", icon: Clock3 },
  ];

  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button key={id} className={activeTab === id ? "active" : ""} onClick={() => onChange(id)}>
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}

function Modal({ title, children, onClose, wide = false }: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal-panel ${wide ? "wide" : ""}`}>
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  dialog: ConfirmState;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ dialog, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Modal title={dialog.title} onClose={onCancel}>
      <div className="confirm-body">
        <p>{dialog.message}</p>
        <div className="modal-actions">
          <button className="secondary-action" onClick={onCancel}>
            Cancelar
          </button>
          <button className={dialog.danger ? "danger-action" : "primary-action"} onClick={onConfirm}>
            {dialog.confirmLabel ?? "Confirmar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

function SearchField({ value, onChange, placeholder }: SearchFieldProps) {
  return (
    <label className="search-field">
      <Search size={21} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

interface SummaryLineProps {
  label: string;
  value: string;
  strong?: boolean;
}

function SummaryLine({ label, value, strong = false }: SummaryLineProps) {
  return (
    <div className={`summary-line ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface EmptyStateProps {
  icon: typeof ClipboardList;
  title: string;
  text: string;
}

function EmptyState({ icon: Icon, title, text }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon size={34} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

export default App;
