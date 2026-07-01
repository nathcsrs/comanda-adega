import { DEFAULT_PRODUCTS, DEFAULT_SETTINGS } from "./data";
import type { AppState, Category, Order, OrderItem, Product, Promotion } from "./types";

const STORAGE_KEY = "comanda-facil-state-v1";
const PRODUCTS_RESET_KEY = "comanda-adega-products-cleared-v1";
const OLD_APP_NAME = "Comanda Fácil";

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

const normalizeCategory = (category: unknown): Category => {
  if (typeof category !== "string") {
    return "Outros";
  }

  return CATEGORY_MIGRATION[category] ?? "Outros";
};

const migrateProduct = (product: Product): Product => ({
  ...product,
  category: normalizeCategory(product.category),
});

const migrateOrderItem = (item: OrderItem): OrderItem => ({
  ...item,
  category: normalizeCategory(item.category),
  originalUnitPrice:
    typeof item.originalUnitPrice === "number" && Number.isFinite(item.originalUnitPrice)
      ? item.originalUnitPrice
      : item.unitPrice,
});

// Mantem comandas antigas compatíveis com as categorias atuais.
const migrateOrder = (order: Order): Order => ({
  ...order,
  items: Array.isArray(order.items) ? order.items.map((item) => migrateOrderItem(item as OrderItem)) : [],
});

const migratePromotion = (promotion: Promotion): Promotion => ({
  ...promotion,
  name: promotion.name?.trim() || undefined,
  promotionalPrice: Math.max(0, Number(promotion.promotionalPrice) || 0),
  startDate: promotion.startDate || new Date().toISOString().slice(0, 10),
  endDate: promotion.endDate || promotion.startDate || new Date().toISOString().slice(0, 10),
  active: Boolean(promotion.active),
  createdAt: promotion.createdAt || new Date().toISOString(),
  updatedAt: promotion.updatedAt || promotion.createdAt || new Date().toISOString(),
});

export const getInitialState = (): AppState => ({
  products: DEFAULT_PRODUCTS,
  promotions: [],
  openOrders: [],
  history: [],
  settings: DEFAULT_SETTINGS,
});

export const loadState = (): AppState => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (!saved) {
      localStorage.setItem(PRODUCTS_RESET_KEY, "true");
      return getInitialState();
    }

    const parsed = JSON.parse(saved) as Partial<AppState>;
    const shouldClearSavedProducts = localStorage.getItem(PRODUCTS_RESET_KEY) !== "true";

    // Limpa apenas os produtos antigos uma vez, preservando comandas, historico e login.
    if (shouldClearSavedProducts) {
      parsed.products = [];
      localStorage.setItem(PRODUCTS_RESET_KEY, "true");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }

    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };

    if (settings.establishmentName === OLD_APP_NAME) {
      settings.establishmentName = DEFAULT_SETTINGS.establishmentName;
    }
    settings.defaultServiceFee = false;

    return {
      products: Array.isArray(parsed.products)
        ? parsed.products.map((product) => migrateProduct(product as Product))
        : DEFAULT_PRODUCTS,
      promotions: Array.isArray(parsed.promotions)
        ? parsed.promotions.map((promotion) => migratePromotion(promotion as Promotion))
        : [],
      openOrders: Array.isArray(parsed.openOrders)
        ? parsed.openOrders.map((order) => migrateOrder(order as Order))
        : [],
      history: Array.isArray(parsed.history) ? parsed.history.map((order) => migrateOrder(order as Order)) : [],
      settings,
    };
  } catch {
    return getInitialState();
  }
};

export const saveState = (state: AppState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const clearSavedState = () => {
  localStorage.removeItem(STORAGE_KEY);
};
