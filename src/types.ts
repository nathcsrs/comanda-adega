export const CATEGORIES = [
  "Cerveja Lata",
  "Cerveja Long Neck",
  "Cerveja Garrafa",
  "Não Alcoolicos",
  "Guloseimas",
  "Petiscos",
  "Outros",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type PaymentMethod =
  | "Dinheiro"
  | "Pix"
  | "Cartão de crédito"
  | "Cartão de débito";

export type OrderStatus = "Aberta" | "Fechada";

export interface Product {
  id: string;
  name: string;
  category: Category;
  price: number;
  active: boolean;
}

export interface Promotion {
  id: string;
  productId: string;
  name?: string;
  promotionalPrice: number;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionSnapshot {
  id: string;
  name?: string;
  originalPrice: number;
  promotionalPrice: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  category: Category;
  unitPrice: number;
  originalUnitPrice?: number;
  promotion?: PromotionSnapshot;
  quantity: number;
  note?: string;
}

export interface PaymentInfo {
  method: PaymentMethod;
  totalPaid: number;
  cashierEntryId?: string;
  cashierSyncedAt?: string;
}

export interface Order {
  id: string;
  table: string;
  customer?: string;
  openedAt: string;
  closedAt?: string;
  status: OrderStatus;
  items: OrderItem[];
  serviceFeeEnabled: boolean;
  payment?: PaymentInfo;
}

export interface AppSettings {
  establishmentName: string;
  defaultServiceFee: boolean;
}

export interface AppState {
  products: Product[];
  promotions: Promotion[];
  openOrders: Order[];
  history: Order[];
  settings: AppSettings;
}
