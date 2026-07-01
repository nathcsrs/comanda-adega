import type { Order } from "./types";

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);

export const formatTime = (isoDate: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));

export const formatDateTime = (isoDate?: string) => {
  if (!isoDate) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
};

export const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

export const parseMoney = (value: string) => {
  const normalizedValue = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value.replace(",", ".");
  const parsed = Number(normalizedValue);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export const parseCurrencyInput = (value: string) => {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return 0;
  }

  return Number(digits) / 100;
};

export const formatCurrencyInput = (value: number) => {
  if (!value) {
    return "";
  }

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const calculateOrderTotals = (order: Pick<Order, "items">) => {
  const subtotal = order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const serviceFee = 0;
  const rawTotal = subtotal;
  const total = Math.max(0, rawTotal);
  const itemsCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return { subtotal, serviceFee, total, itemsCount };
};
