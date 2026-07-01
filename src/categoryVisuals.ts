import {
  Beer,
  Candy,
  CupSoda,
  GlassWater,
  Package,
  Utensils,
  Wine,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "./types";
import { normalizeText } from "./utils";

export type CategoryVisual = {
  icon: LucideIcon;
  className: string;
  label: string;
  color: string;
  softColor: string;
};

export const categoryVisuals: Record<Category, CategoryVisual> = {
  "Cerveja Lata": {
    icon: Beer,
    className: "category-cerveja-lata",
    label: "Lata",
    color: "#24c8ff",
    softColor: "rgba(36, 200, 255, 0.14)",
  },
  "Cerveja Long Neck": {
    icon: Wine,
    className: "category-cerveja-long-neck",
    label: "Long neck",
    color: "#7b5cff",
    softColor: "rgba(123, 92, 255, 0.15)",
  },
  "Cerveja Garrafa": {
    icon: GlassWater,
    className: "category-cerveja-garrafa",
    label: "Garrafa",
    color: "#ffc531",
    softColor: "rgba(255, 197, 49, 0.14)",
  },
  "Não Alcoolicos": {
    icon: CupSoda,
    className: "category-nao-alcoolicos",
    label: "Sem álcool",
    color: "#61e7ca",
    softColor: "rgba(97, 231, 202, 0.14)",
  },
  Guloseimas: {
    icon: Candy,
    className: "category-guloseimas",
    label: "Doce",
    color: "#ff7c6f",
    softColor: "rgba(255, 124, 111, 0.14)",
  },
  Petiscos: {
    icon: Utensils,
    className: "category-petiscos",
    label: "Petiscos",
    color: "#ffae35",
    softColor: "rgba(255, 174, 53, 0.14)",
  },
  Outros: {
    icon: Package,
    className: "category-outros",
    label: "Geral",
    color: "#d85dff",
    softColor: "rgba(216, 93, 255, 0.16)",
  },
};

const categoryAliases = new Map<string, Category>();

Object.keys(categoryVisuals).forEach((category) => {
  categoryAliases.set(normalizeText(category), category as Category);
});

["Não Alcoólicos", "Nao Alcoolicos", "Não Alcoolicos", "Nao Alcoólicos"].forEach((alias) => {
  categoryAliases.set(normalizeText(alias), "Não Alcoolicos");
});

export const getCategoryVisual = (category?: string | null) =>
  categoryVisuals[categoryAliases.get(normalizeText(category ?? "")) ?? "Outros"];
