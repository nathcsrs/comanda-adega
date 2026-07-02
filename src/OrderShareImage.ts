import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCategoryVisual, type CategoryVisual } from "./categoryVisuals";
import type { Order, OrderItem } from "./types";
import { calculateOrderTotals, formatCurrency } from "./utils";

const IMAGE_WIDTH = 1080;
const MIN_IMAGE_HEIGHT = 1350;
const RENDER_SCALE = 2;
const IMAGE_PADDING = 72;
const TABLE_WIDTH = IMAGE_WIDTH - IMAGE_PADDING * 2;
const TABLE_INSET = 32;
const ICON_COLUMN_WIDTH = 46;
const GRID_GAP = 18;
const QTY_COLUMN_WIDTH = 88;
const TOTAL_COLUMN_WIDTH = 180;
const NAME_COLUMN_WIDTH =
  TABLE_WIDTH - TABLE_INSET * 2 - ICON_COLUMN_WIDTH - QTY_COLUMN_WIDTH - TOTAL_COLUMN_WIDTH - GRID_GAP * 3;
const SHARE_LOGO_SOURCES = [
  `${import.meta.env.BASE_URL}logo-tano-grale.png`,
  `${import.meta.env.BASE_URL}icon-512.png`,
  `${import.meta.env.BASE_URL}apple-touch-icon.png`,
];
const RECEIPT_ASSET_SOURCES = {
  background: `${import.meta.env.BASE_URL}receipt-bg-aurora.png`,
  logo: `${import.meta.env.BASE_URL}receipt-logo.jpg`,
  calendar: `${import.meta.env.BASE_URL}receipt-icon-calendar.png`,
  customer: `${import.meta.env.BASE_URL}receipt-icon-customer.png`,
  table: `${import.meta.env.BASE_URL}receipt-icon-table.png`,
  titleBand: `${import.meta.env.BASE_URL}receipt-band-title.png`,
  thanksBand: `${import.meta.env.BASE_URL}receipt-band-thanks.png`,
};
const FALLBACK_MESSAGE = "Olá! Segue sua comanda da Adega Tá no Grale.";
const FOOTER_MESSAGE = "Sua comanda é individual e não pode ser transferida.";
const NO_TABLE_LABEL = "Sem mesa";
const RECEIPT_MIN_HEIGHT = 1580;
const RECEIPT_CARD_X = 58;
const RECEIPT_CARD_TOP = 32;
const RECEIPT_CARD_WIDTH = IMAGE_WIDTH - RECEIPT_CARD_X * 2;
const RECEIPT_INSET = 32;
const RECEIPT_NAVY = "#061b3f";
const RECEIPT_BLUE = "#1164b6";
const RECEIPT_LIGHT_BLUE = "#eaf6ff";
const RECEIPT_DASH = "rgba(17, 100, 182, 0.42)";
const RECEIPT_PRODUCT_WIDTH = 492;
const RECEIPT_LOGO_Y = 50;
const RECEIPT_LOGO_WIDTH = 440;
const RECEIPT_LOGO_HEIGHT = 318;
const RECEIPT_TITLE_Y = 382;
const RECEIPT_TITLE_HEIGHT = 94;
const RECEIPT_INFO_Y = 518;
const RECEIPT_TOTAL_HEIGHT = 86;
const RECEIPT_META_LABEL_FONT = "800 25px 'Arial Narrow', Arial, sans-serif";
const RECEIPT_META_VALUE_FONT = "700 25px 'Arial Narrow', Arial, sans-serif";

type TextLayout = {
  font: string;
  lineHeight: number;
  lines: string[];
};

type MeasuredItemRow = {
  item: OrderItem;
  visual: CategoryVisual;
  name: TextLayout;
  detailLines: string[];
  noteLines: string[];
  height: number;
};

type ReceiptItemRow = {
  item: OrderItem;
  productLines: string[];
  detailLines: string[];
  height: number;
};

type ReceiptAssets = {
  background: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  calendar: HTMLImageElement | null;
  customer: HTMLImageElement | null;
  table: HTMLImageElement | null;
  titleBand: HTMLImageElement | null;
  thanksBand: HTMLImageElement | null;
};

const isPromotionalItem = (item: OrderItem) => {
  const originalPrice = item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice;
  return Boolean(item.promotion && originalPrice > item.unitPrice);
};

const getOrderTitle = (order: Order) => {
  if (order.table === NO_TABLE_LABEL && order.customer?.trim()) {
    return order.customer.trim();
  }

  return order.table;
};

const getMesaValue = (order: Order) => {
  const title = getOrderTitle(order);
  const tableMatch = title.match(/^mesa\s*(.+)$/i);

  return tableMatch?.[1]?.trim() || title;
};

const getOriginalPrice = (item: OrderItem) => item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice;

const isPaidReceipt = (order: Order) => order.status === "Fechada";

const usesReceiptShareLayout = (order: Order) => order.status === "Aberta" || isPaidReceipt(order);

const getReceiptStatusLabel = (order: Order) => (isPaidReceipt(order) ? "PAGO" : "PENDENTE");

const getReceiptStatusColor = (order: Order) => (isPaidReceipt(order) ? "#118b2d" : "#b87900");

const getReceiptDateSource = (order: Order) => order.closedAt || order.openedAt;

const getReceiptNumber = (order: Order) => {
  const source = order.payment?.cashierEntryId || order.id;
  const cleaned = source
    .replace(/^comanda-/i, "")
    .replace(/^cash-/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

  return `#${(cleaned || source).slice(-6).padStart(6, "0")}`;
};

const getPaymentMethodLabel = (order: Order) => order.payment?.method || "";

const formatShareDate = (isoDate: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(isoDate));

const formatShareTime = (isoDate: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));

const sanitizeFilePart = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

export const getOrderShareFallbackMessage = () => FALLBACK_MESSAGE;

export const getOrderShareFileName = (order: Order) => {
  const title = getOrderTitle(order);
  const tableNumber = title.match(/mesa\s*(\d+)/i)?.[1];

  if (tableNumber) {
    return `comanda-mesa-${tableNumber.padStart(2, "0")}.png`;
  }

  return `comanda-${sanitizeFilePart(title) || "adega"}.png`;
};

const waitForFonts = async () => {
  try {
    await document.fonts?.ready;
  } catch {
    // If font loading is unavailable, canvas falls back to the browser fonts.
  }
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

const loadFirstImage = async (sources: string[]) => {
  for (const source of sources) {
    const image = await loadImage(source);

    if (image) {
      return image;
    }
  }

  return null;
};

const loadReceiptAssets = async (): Promise<ReceiptAssets> => {
  const [background, logo, calendar, customer, table, titleBand, thanksBand] = await Promise.all([
    loadImage(RECEIPT_ASSET_SOURCES.background),
    loadImage(RECEIPT_ASSET_SOURCES.logo),
    loadImage(RECEIPT_ASSET_SOURCES.calendar),
    loadImage(RECEIPT_ASSET_SOURCES.customer),
    loadImage(RECEIPT_ASSET_SOURCES.table),
    loadImage(RECEIPT_ASSET_SOURCES.titleBand),
    loadImage(RECEIPT_ASSET_SOURCES.thanksBand),
  ]);

  return { background, logo, calendar, customer, table, titleBand, thanksBand };
};

const iconMarkupToDataUrl = (visual: CategoryVisual) => {
  const markup = renderToStaticMarkup(
    createElement(visual.icon, {
      size: 36,
      color: visual.color,
      strokeWidth: 2.6,
      absoluteStrokeWidth: true,
    }),
  );

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
};

const loadCategoryIconImages = async (rows: MeasuredItemRow[]) => {
  const visuals = new Map<string, CategoryVisual>();

  rows.forEach((row) => {
    visuals.set(row.visual.className, row.visual);
  });

  const loadedEntries = await Promise.all(
    Array.from(visuals.entries()).map(async ([key, visual]) => [key, await loadImage(iconMarkupToDataUrl(visual))] as const),
  );

  return new Map(loadedEntries);
};

const setFont = (context: CanvasRenderingContext2D, font: string) => {
  context.font = font;
};

const wrapText = (context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string) => {
  setFont(context, font);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  const pushBrokenWord = (word: string) => {
    let part = "";

    Array.from(word).forEach((letter) => {
      const testPart = `${part}${letter}`;

      if (context.measureText(testPart).width <= maxWidth || !part) {
        part = testPart;
        return;
      }

      lines.push(part);
      part = letter;
    });

    currentLine = part;
  };

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (context.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    if (context.measureText(word).width > maxWidth) {
      pushBrokenWord(word);
      return;
    }

    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [text];
};

const measureName = (context: CanvasRenderingContext2D, productName: string): TextLayout => {
  const name = productName.toUpperCase();
  const options = [
    { font: "700 34px Impact, Arial Black, sans-serif", lineHeight: 39 },
    { font: "700 31px Impact, Arial Black, sans-serif", lineHeight: 36 },
    { font: "700 29px Impact, Arial Black, sans-serif", lineHeight: 34 },
  ];

  for (const option of options) {
    const lines = wrapText(context, name, NAME_COLUMN_WIDTH, option.font);

    if (lines.length <= 2) {
      return { ...option, lines };
    }
  }

  const fallback = options[options.length - 1];
  return { ...fallback, lines: wrapText(context, name, NAME_COLUMN_WIDTH, fallback.font) };
};

const measureRows = (context: CanvasRenderingContext2D, order: Order): MeasuredItemRow[] =>
  order.items.map((item) => {
    const visual = getCategoryVisual(item.category);
    const name = measureName(context, item.productName);
    const detailText = isPromotionalItem(item)
      ? `Promoção aplicada: ${formatCurrency(item.unitPrice)} cada${
          item.promotion?.name ? ` - ${item.promotion.name}` : ""
        }`
      : "";
    const detailLines = detailText ? wrapText(context, detailText, NAME_COLUMN_WIDTH, "600 22px Arial, sans-serif") : [];
    const noteLines = item.note ? wrapText(context, `Obs: ${item.note}`, NAME_COLUMN_WIDTH, "600 22px Arial, sans-serif") : [];
    const textHeight = name.lines.length * name.lineHeight + detailLines.length * 28 + noteLines.length * 28;
    const height = Math.max(88, textHeight + 34);

    return { item, visual, name, detailLines, noteLines, height };
  });

const measureReceiptRows = (context: CanvasRenderingContext2D, order: Order): ReceiptItemRow[] =>
  order.items.map((item) => {
    const productLines = wrapText(context, item.productName, RECEIPT_PRODUCT_WIDTH, "700 27px Arial, sans-serif");
    const detailText = isPromotionalItem(item)
      ? `Promo\u00e7\u00e3o: ${formatCurrency(getOriginalPrice(item))} por ${formatCurrency(item.unitPrice)}`
      : "";
    const detailLines = detailText ? wrapText(context, detailText, RECEIPT_PRODUCT_WIDTH, "600 20px Arial, sans-serif") : [];
    const rowTextHeight = productLines.length * 32 + detailLines.length * 24;
    const height = Math.max(66, rowTextHeight + 22);

    return { item, productLines, detailLines, height };
  });

const makeRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
};

const fillRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string | CanvasGradient,
) => {
  context.save();
  makeRoundedRect(context, x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
  context.restore();
};

const strokeRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeStyle: string | CanvasGradient,
  lineWidth: number,
) => {
  context.save();
  makeRoundedRect(context, x, y, width, height, radius);
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
};

const drawText = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    font: string;
    color: string | CanvasGradient;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    shadow?: boolean;
  },
) => {
  context.save();
  context.font = options.font;
  context.fillStyle = options.color;
  context.textAlign = options.align ?? "left";
  context.textBaseline = options.baseline ?? "top";

  if (options.shadow) {
    context.shadowColor = "rgba(0, 0, 0, 0.75)";
    context.shadowBlur = 9;
    context.shadowOffsetY = 4;
  }

  context.fillText(text, x, y);
  context.restore();
};

const drawContainImage = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
};

const drawCoverImage = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
};

const drawCroppedImage = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number },
) => {
  context.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    target.x,
    target.y,
    target.width,
    target.height,
  );
};

const drawHeaderLogo = (context: CanvasRenderingContext2D, logo: HTMLImageElement | null) => {
  if (!logo) {
    drawText(context, "ADEGA TÁ NO GRALE", IMAGE_WIDTH / 2, 72, {
      font: "800 58px Arial Black, Impact, sans-serif",
      color: "#ffd447",
      align: "center",
      shadow: true,
    });
    return;
  }

  context.save();
  context.shadowColor = "rgba(36, 207, 255, 0.28)";
  context.shadowBlur = 28;
  drawContainImage(context, logo, 250, 34, 580, 176);
  context.restore();
};

const drawInfoCard = (context: CanvasRenderingContext2D, order: Order, y: number) => {
  const cardX = 112;
  const cardWidth = IMAGE_WIDTH - cardX * 2;
  const cardHeight = 150;
  const borderGradient = context.createLinearGradient(cardX, y, cardX + cardWidth, y);
  borderGradient.addColorStop(0, "#22c8ff");
  borderGradient.addColorStop(0.52, "#6b4dff");
  borderGradient.addColorStop(1, "#d743ff");

  fillRoundedRect(context, cardX, y, cardWidth, cardHeight, 24, "rgba(7, 10, 18, 0.86)");
  strokeRoundedRect(context, cardX, y, cardWidth, cardHeight, 24, borderGradient, 4);

  const col1X = cardX + 142;
  const col2X = cardX + 425;
  const col3X = cardX + 710;
  const dividerTop = y + 28;
  const dividerBottom = y + cardHeight - 28;

  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.18)";
  context.lineWidth = 2;
  [cardX + 285, cardX + 565].forEach((lineX) => {
    context.beginPath();
    context.moveTo(lineX, dividerTop);
    context.lineTo(lineX, dividerBottom);
    context.stroke();
  });
  context.restore();

  drawText(context, "MESA", col1X, y + 31, {
    font: "800 27px Arial Black, sans-serif",
    color: "#bf63ff",
    align: "center",
  });
  drawText(context, getMesaValue(order), col1X, y + 64, {
    font: "800 49px Arial Black, Impact, sans-serif",
    color: "#ffffff",
    align: "center",
    shadow: true,
  });

  drawText(context, "DATA", col2X, y + 33, {
    font: "800 27px Arial Black, sans-serif",
    color: "#24cfff",
    align: "center",
  });
  drawText(context, formatShareDate(order.openedAt), col2X, y + 73, {
    font: "800 32px Arial Black, sans-serif",
    color: "#ffffff",
    align: "center",
    shadow: true,
  });

  drawText(context, "HORA", col3X, y + 33, {
    font: "800 27px Arial Black, sans-serif",
    color: "#24cfff",
    align: "center",
  });
  drawText(context, formatShareTime(order.openedAt), col3X, y + 73, {
    font: "800 32px Arial Black, sans-serif",
    color: "#ffffff",
    align: "center",
    shadow: true,
  });
};

const drawItemIcon = (
  context: CanvasRenderingContext2D,
  row: MeasuredItemRow,
  iconImage: HTMLImageElement | null | undefined,
  x: number,
  y: number,
) => {
  fillRoundedRect(context, x, y, ICON_COLUMN_WIDTH, ICON_COLUMN_WIDTH, 14, row.visual.softColor);
  strokeRoundedRect(context, x, y, ICON_COLUMN_WIDTH, ICON_COLUMN_WIDTH, 14, `${row.visual.color}66`, 2);

  if (iconImage) {
    drawContainImage(context, iconImage, x + 5, y + 5, 36, 36);
    return;
  }

  drawText(context, "□", x + ICON_COLUMN_WIDTH / 2, y + 9, {
    font: "800 25px Arial Black, sans-serif",
    color: row.visual.color,
    align: "center",
  });
};

const drawItemRows = (
  context: CanvasRenderingContext2D,
  rows: MeasuredItemRow[],
  iconImages: Map<string, HTMLImageElement | null>,
  y: number,
) => {
  const listX = IMAGE_PADDING;
  const headerHeight = 68;
  const listHeight = headerHeight + rows.reduce((sum, row) => sum + row.height, 0);
  const innerX = listX + TABLE_INSET;
  const iconX = innerX;
  const nameX = iconX + ICON_COLUMN_WIDTH + GRID_GAP;
  const qtyX = nameX + NAME_COLUMN_WIDTH + GRID_GAP;
  const totalX = qtyX + QTY_COLUMN_WIDTH + GRID_GAP;
  const totalRight = totalX + TOTAL_COLUMN_WIDTH;

  fillRoundedRect(context, listX, y, TABLE_WIDTH, listHeight, 22, "rgba(5, 7, 12, 0.82)");

  const headerGradient = context.createLinearGradient(listX, y, listX + TABLE_WIDTH, y);
  headerGradient.addColorStop(0, "rgba(126, 52, 164, 0.9)");
  headerGradient.addColorStop(1, "rgba(61, 24, 93, 0.86)");
  fillRoundedRect(context, listX, y, TABLE_WIDTH, headerHeight, 22, headerGradient);

  drawText(context, "ITEM", innerX, y + 21, {
    font: "700 28px Arial Black, Impact, sans-serif",
    color: "#ffffff",
  });
  drawText(context, "QTD", qtyX + QTY_COLUMN_WIDTH / 2, y + 21, {
    font: "700 28px Arial Black, Impact, sans-serif",
    color: "#ffffff",
    align: "center",
  });
  drawText(context, "TOTAL", totalRight, y + 21, {
    font: "700 28px Arial Black, Impact, sans-serif",
    color: "#ffffff",
    align: "right",
  });

  let rowY = y + headerHeight;

  rows.forEach((row, index) => {
    const { item } = row;
    const total = item.unitPrice * item.quantity;
    const centerY = rowY + row.height / 2;

    if (index > 0) {
      context.save();
      context.strokeStyle = "rgba(255, 255, 255, 0.14)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(innerX, rowY);
      context.lineTo(listX + TABLE_WIDTH - TABLE_INSET, rowY);
      context.stroke();
      context.restore();
    }

    drawItemIcon(context, row, iconImages.get(row.visual.className), iconX, centerY - ICON_COLUMN_WIDTH / 2);

    const detailHeight = row.detailLines.length * 28 + row.noteLines.length * 28;
    const textBlockHeight = row.name.lines.length * row.name.lineHeight + detailHeight;
    let textY = centerY - textBlockHeight / 2;

    row.name.lines.forEach((line) => {
      drawText(context, line, nameX, textY, {
        font: row.name.font,
        color: "#f7f7fb",
        shadow: true,
      });
      textY += row.name.lineHeight;
    });

    row.detailLines.forEach((line) => {
      drawText(context, line, nameX, textY + 2, {
        font: "600 22px Arial, sans-serif",
        color: "#ffd447",
      });
      textY += 28;
    });

    row.noteLines.forEach((line) => {
      drawText(context, line, nameX, textY + 2, {
        font: "600 22px Arial, sans-serif",
        color: "#b9c9d8",
      });
      textY += 28;
    });

    drawText(context, String(item.quantity), qtyX + QTY_COLUMN_WIDTH / 2, centerY, {
      font: "800 36px Arial Black, sans-serif",
      color: "#ffffff",
      align: "center",
      baseline: "middle",
      shadow: true,
    });

    drawText(context, formatCurrency(total), totalRight, centerY, {
      font: "800 31px Arial Black, sans-serif",
      color: isPromotionalItem(item) ? "#ffd447" : "#ffffff",
      align: "right",
      baseline: "middle",
      shadow: true,
    });

    rowY += row.height;
  });

  strokeRoundedRect(context, listX, y, TABLE_WIDTH, listHeight, 22, "rgba(36, 207, 255, 0.2)", 2);

  return y + listHeight;
};

const drawTotals = (context: CanvasRenderingContext2D, order: Order, y: number) => {
  const totals = calculateOrderTotals(order);
  const totalGradient = context.createLinearGradient(IMAGE_PADDING, y, IMAGE_WIDTH - IMAGE_PADDING, y);
  totalGradient.addColorStop(0, "#22c8ff");
  totalGradient.addColorStop(0.55, "#7b5cff");
  totalGradient.addColorStop(1, "#ffd447");

  context.save();
  context.strokeStyle = "#9f45ff";
  context.setLineDash([13, 10]);
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(IMAGE_PADDING + 8, y);
  context.lineTo(IMAGE_WIDTH - IMAGE_PADDING - 8, y);
  context.stroke();
  context.restore();

  let currentY = y + 48;
  const labelX = IMAGE_PADDING + 18;
  const valueX = IMAGE_WIDTH - IMAGE_PADDING - 18;

  drawText(context, "Subtotal", labelX, currentY, {
    font: "700 32px Arial, sans-serif",
    color: "#c7d6e8",
  });
  drawText(context, formatCurrency(totals.subtotal), valueX, currentY, {
    font: "800 36px Arial Black, sans-serif",
    color: "#ffffff",
    align: "right",
    shadow: true,
  });

  currentY += 55;

  if (totals.serviceFee > 0) {
    drawText(context, "Taxa de serviço", labelX, currentY, {
      font: "700 32px Arial, sans-serif",
      color: "#c7d6e8",
    });
    drawText(context, formatCurrency(totals.serviceFee), valueX, currentY, {
      font: "800 36px Arial Black, sans-serif",
      color: "#ffffff",
      align: "right",
      shadow: true,
    });
    currentY += 55;
  }

  drawText(context, "TOTAL", labelX, currentY + 18, {
    font: "800 50px Impact, Arial Black, sans-serif",
    color: "#ffffff",
    shadow: true,
  });
  drawText(context, formatCurrency(totals.total), valueX, currentY, {
    font: "800 70px Arial Black, Impact, sans-serif",
    color: totalGradient,
    align: "right",
    shadow: true,
  });

  return currentY + 116;
};

const drawLockIcon = (context: CanvasRenderingContext2D, x: number, y: number) => {
  context.save();
  context.strokeStyle = "#ffd447";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";

  makeRoundedRect(context, x, y + 22, 42, 35, 7);
  context.stroke();

  context.beginPath();
  context.moveTo(x + 11, y + 22);
  context.lineTo(x + 11, y + 15);
  context.quadraticCurveTo(x + 21, y - 2, x + 31, y + 15);
  context.lineTo(x + 31, y + 22);
  context.stroke();

  context.beginPath();
  context.moveTo(x + 21, y + 37);
  context.lineTo(x + 21, y + 45);
  context.stroke();
  context.restore();
};

const drawFooter = (context: CanvasRenderingContext2D, y: number) => {
  const footerX = 126;
  const footerWidth = IMAGE_WIDTH - footerX * 2;
  fillRoundedRect(context, footerX, y, footerWidth, 104, 24, "rgba(255, 255, 255, 0.035)");
  strokeRoundedRect(context, footerX, y, footerWidth, 104, 24, "rgba(255, 255, 255, 0.1)", 2);

  const footerFont = "700 27px Arial, sans-serif";
  context.save();
  context.font = footerFont;
  const textWidth = context.measureText(FOOTER_MESSAGE).width;
  context.restore();

  const lockWidth = 42;
  const gap = 24;
  const groupWidth = lockWidth + gap + textWidth;
  const groupX = footerX + (footerWidth - groupWidth) / 2;
  const lockX = groupX;
  const textX = groupX + lockWidth + gap;

  drawLockIcon(context, lockX, y + 24);
  drawText(context, FOOTER_MESSAGE, textX, y + 39, {
    font: footerFont,
    color: "#ffffff",
  });
};

const drawBackground = (context: CanvasRenderingContext2D, canvasHeight: number) => {
  const background = context.createLinearGradient(0, 0, IMAGE_WIDTH, canvasHeight);
  background.addColorStop(0, "#04050a");
  background.addColorStop(0.34, "#111024");
  background.addColorStop(0.72, "#061923");
  background.addColorStop(1, "#030407");
  context.fillStyle = background;
  context.fillRect(0, 0, IMAGE_WIDTH, canvasHeight);

  context.save();
  context.globalAlpha = 0.24;
  for (let x = 0; x < IMAGE_WIDTH; x += 58) {
    context.strokeStyle = x % 116 === 0 ? "rgba(36, 207, 255, 0.16)" : "rgba(255, 255, 255, 0.04)";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + canvasHeight * 0.16, canvasHeight);
    context.stroke();
  }
  context.restore();

  fillRoundedRect(context, 34, 28, IMAGE_WIDTH - 68, canvasHeight - 56, 30, "rgba(255, 255, 255, 0.025)");
};

const drawReceiptMountains = (context: CanvasRenderingContext2D, canvasHeight: number) => {
  context.save();
  context.globalAlpha = 0.72;
  context.fillStyle = "#bfeeff";

  const baseY = canvasHeight - 150;
  context.beginPath();
  context.moveTo(0, canvasHeight);
  context.lineTo(0, baseY + 34);
  context.lineTo(88, baseY - 18);
  context.lineTo(154, baseY + 22);
  context.lineTo(238, baseY - 56);
  context.lineTo(330, baseY + 42);
  context.lineTo(420, baseY - 4);
  context.lineTo(520, canvasHeight);
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(560, canvasHeight);
  context.lineTo(650, baseY + 28);
  context.lineTo(730, baseY - 48);
  context.lineTo(824, baseY + 34);
  context.lineTo(924, baseY - 26);
  context.lineTo(1080, baseY + 72);
  context.lineTo(1080, canvasHeight);
  context.closePath();
  context.fill();

  context.globalAlpha = 0.92;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(196, baseY - 18);
  context.lineTo(238, baseY - 56);
  context.lineTo(276, baseY - 16);
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(688, baseY - 10);
  context.lineTo(730, baseY - 48);
  context.lineTo(768, baseY - 8);
  context.closePath();
  context.fill();
  context.restore();
};

const drawReceiptBackground = (
  context: CanvasRenderingContext2D,
  canvasHeight: number,
  backgroundImage?: HTMLImageElement | null,
) => {
  if (backgroundImage) {
    drawCoverImage(context, backgroundImage, 0, 0, IMAGE_WIDTH, canvasHeight);
  } else {
    const background = context.createLinearGradient(0, 0, IMAGE_WIDTH, canvasHeight);
    background.addColorStop(0, "#020817");
    background.addColorStop(0.44, "#071f46");
    background.addColorStop(1, "#031126");
    context.fillStyle = background;
    context.fillRect(0, 0, IMAGE_WIDTH, canvasHeight);
    drawReceiptMountains(context, canvasHeight);
  }

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.38)";
  context.shadowBlur = 30;
  context.shadowOffsetY = 14;
  const cardGradient = context.createLinearGradient(RECEIPT_CARD_X, RECEIPT_CARD_TOP, RECEIPT_CARD_X, canvasHeight - 34);
  cardGradient.addColorStop(0, "#ffffff");
  cardGradient.addColorStop(0.65, "#fbfdff");
  cardGradient.addColorStop(1, "#eaf6ff");
  fillRoundedRect(
    context,
    RECEIPT_CARD_X,
    RECEIPT_CARD_TOP,
    RECEIPT_CARD_WIDTH,
    canvasHeight - RECEIPT_CARD_TOP * 2,
    36,
    cardGradient,
  );
  context.restore();
};

const drawReceiptLogo = (context: CanvasRenderingContext2D, logo: HTMLImageElement | null) => {
  if (!logo) {
    drawText(context, "ADEGA T\u00c1 NO GRALE", IMAGE_WIDTH / 2, 86, {
      font: "800 60px Arial Black, Impact, sans-serif",
      color: "#ffbf24",
      align: "center",
    });
    return;
  }

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.28)";
  context.shadowBlur = 9;
  context.shadowOffsetY = 5;
  drawContainImage(
    context,
    logo,
    (IMAGE_WIDTH - RECEIPT_LOGO_WIDTH) / 2,
    RECEIPT_LOGO_Y,
    RECEIPT_LOGO_WIDTH,
    RECEIPT_LOGO_HEIGHT,
  );
  context.restore();
};

const drawReceiptCheck = (context: CanvasRenderingContext2D, x: number, y: number, size: number, color = "#ffffff") => {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 6;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2 - 5, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(x + size * 0.29, y + size * 0.52);
  context.lineTo(x + size * 0.45, y + size * 0.68);
  context.lineTo(x + size * 0.74, y + size * 0.34);
  context.stroke();
  context.restore();
};

const drawReceiptTitleBandImage = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  y: number,
  height: number,
) => {
  if (!image) {
    drawReceiptBrushBand(context, y, "COMPROVANTE DE COMANDA", height);
    return y + height;
  }

  const source = { x: 0, y: image.height * 0.4, width: image.width, height: image.height * 0.18 };
  const width = Math.min(RECEIPT_CARD_WIDTH - 150, 805);
  const drawHeight = width * (source.height / source.width);
  const x = (IMAGE_WIDTH - width) / 2;
  drawCroppedImage(
    context,
    image,
    source,
    { x, y, width, height: drawHeight },
  );

  return y + drawHeight;
};

const drawReceiptThanksBandImage = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  y: number,
  height: number,
) => {
  if (!image) {
    drawReceiptBrushBand(context, y, "OBRIGADO E VOLTE SEMPRE!", height);
    return y + height;
  }

  const source = { x: 0, y: image.height * 0.28, width: image.width, height: image.height * 0.4 };
  const width = Math.min(RECEIPT_CARD_WIDTH - 155, 810);
  const drawHeight = width * (source.height / source.width);
  const x = (IMAGE_WIDTH - width) / 2;
  drawCroppedImage(
    context,
    image,
    source,
    { x, y, width, height: drawHeight },
  );

  return y + drawHeight;
};

const drawReceiptBrushBand = (context: CanvasRenderingContext2D, y: number, text: string, height = 76) => {
  const x = RECEIPT_CARD_X + 34;
  const width = RECEIPT_CARD_WIDTH - 68;
  const fontSize = height <= 66 ? 38 : 40;
  const checkSize = height <= 66 ? 44 : 50;

  context.save();
  context.fillStyle = RECEIPT_NAVY;
  context.beginPath();
  context.moveTo(x, y + 15);
  context.lineTo(x + 58, y + 6);
  context.lineTo(x + width - 42, y + 2);
  context.lineTo(x + width, y + 15);
  context.lineTo(x + width - 18, y + height - 11);
  context.lineTo(x + 42, y + height - 4);
  context.lineTo(x + 4, y + height - 18);
  context.closePath();
  context.fill();
  context.restore();

  drawReceiptCheck(context, x + 96, y + (height - checkSize) / 2, checkSize);
  drawText(context, text, x + width / 2 + 34, y + (height - fontSize) / 2 - 1, {
    font: `800 ${fontSize}px Impact, Arial Black, sans-serif`,
    color: "#ffffff",
    align: "center",
  });
};

const drawReceiptDashedLine = (
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = RECEIPT_DASH,
) => {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.15;
  context.globalAlpha = 0.62;
  context.setLineDash([7, 9]);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.restore();
};

const drawReceiptIcon = (context: CanvasRenderingContext2D, kind: string, x: number, y: number) => {
  context.save();
  context.strokeStyle = RECEIPT_BLUE;
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (kind === "calendar") {
    makeRoundedRect(context, x, y + 5, 42, 42, 5);
    context.stroke();
    context.beginPath();
    context.moveTo(x + 10, y);
    context.lineTo(x + 10, y + 12);
    context.moveTo(x + 32, y);
    context.lineTo(x + 32, y + 12);
    context.moveTo(x, y + 19);
    context.lineTo(x + 42, y + 19);
    context.stroke();
  } else if (kind === "clock") {
    context.beginPath();
    context.arc(x + 22, y + 25, 21, 0, Math.PI * 2);
    context.moveTo(x + 22, y + 25);
    context.lineTo(x + 22, y + 12);
    context.moveTo(x + 22, y + 25);
    context.lineTo(x + 33, y + 31);
    context.stroke();
  } else if (kind === "receipt") {
    makeRoundedRect(context, x + 4, y + 2, 36, 48, 4);
    context.stroke();
    [14, 24, 34].forEach((lineY) => {
      context.beginPath();
      context.moveTo(x + 13, y + lineY);
      context.lineTo(x + 31, y + lineY);
      context.stroke();
    });
  } else if (kind === "table") {
    context.beginPath();
    context.moveTo(x + 7, y + 12);
    context.lineTo(x + 39, y + 12);
    context.moveTo(x + 10, y + 12);
    context.lineTo(x + 10, y + 50);
    context.moveTo(x + 36, y + 12);
    context.lineTo(x + 36, y + 50);
    context.moveTo(x + 7, y + 34);
    context.lineTo(x + 39, y + 34);
    context.stroke();
  } else if (kind === "user") {
    context.beginPath();
    context.arc(x + 23, y + 16, 14, 0, Math.PI * 2);
    context.moveTo(x + 4, y + 51);
    context.quadraticCurveTo(x + 23, y + 32, x + 42, y + 51);
    context.stroke();
  } else if (kind === "card") {
    makeRoundedRect(context, x, y + 8, 48, 36, 5);
    context.stroke();
    context.beginPath();
    context.moveTo(x, y + 20);
    context.lineTo(x + 48, y + 20);
    context.moveTo(x + 9, y + 34);
    context.lineTo(x + 22, y + 34);
    context.stroke();
  } else {
    drawReceiptCheck(context, x, y + 2, 48, RECEIPT_BLUE);
  }

  context.restore();
};

const drawReceiptAssetIcon = (
  context: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  assets?: ReceiptAssets,
) => {
  const iconSize = 48;
  const iconImage = kind === "calendar" ? assets?.calendar : kind === "user" ? assets?.customer : assets?.table;

  if (!iconImage) {
    drawReceiptIcon(context, kind, x + 3, y + 2);
    return;
  }

  const crops: Record<string, { x: number; y: number; width: number; height: number }> = {
    calendar: {
      x: iconImage.width * 0.22,
      y: iconImage.height * 0.3,
      width: iconImage.width * 0.58,
      height: iconImage.height * 0.42,
    },
    user: {
      x: iconImage.width * 0.24,
      y: iconImage.height * 0.31,
      width: iconImage.width * 0.52,
      height: iconImage.height * 0.38,
    },
    table: {
      x: iconImage.width * 0.24,
      y: iconImage.height * 0.2,
      width: iconImage.width * 0.54,
      height: iconImage.height * 0.58,
    },
  };

  drawCroppedImage(
    context,
    iconImage,
    crops[kind] ?? { x: 0, y: 0, width: iconImage.width, height: iconImage.height },
    { x, y, width: iconSize, height: iconSize },
  );
};

const drawReceiptInfoCell = (
  context: CanvasRenderingContext2D,
  kind: string,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  assets?: ReceiptAssets,
) => {
  void width;
  const contentY = y + (height - 86) / 2;

  drawReceiptAssetIcon(context, kind, x + 16, contentY + 19, assets);
  drawText(context, label, x + 88, contentY + 21, {
    font: RECEIPT_META_LABEL_FONT,
    color: RECEIPT_NAVY,
  });
  drawText(context, value, x + 88, contentY + 52, {
    font: RECEIPT_META_VALUE_FONT,
    color: "#071126",
  });
};

const getReceiptCustomer = (order: Order) => {
  const customer = order.customer?.trim();
  return customer && customer !== getOrderTitle(order) ? customer : "";
};

const drawReceiptInfo = (context: CanvasRenderingContext2D, order: Order, y: number) => {
  const infoX = RECEIPT_CARD_X + RECEIPT_INSET;
  const infoWidth = RECEIPT_CARD_WIDTH - RECEIPT_INSET * 2;
  const columnWidth = infoWidth / 2;
  const rowHeight = 86;
  const receiptDate = getReceiptDateSource(order);
  const customer = getReceiptCustomer(order);
  const cells = [
    { kind: "calendar", label: "DATA:", value: formatShareDate(receiptDate) },
    { kind: "clock", label: "HORA:", value: formatShareTime(receiptDate) },
    { kind: "receipt", label: "N\u00ba COMANDA:", value: getReceiptNumber(order) },
    { kind: "table", label: "MESA:", value: getMesaValue(order) },
    ...(customer ? [{ kind: "user", label: "CLIENTE:", value: customer }] : []),
  ];

  cells.forEach((cell, index) => {
    const isLastOdd = cells.length % 2 === 1 && index === cells.length - 1;
    const row = Math.floor(index / 2);
    const col = index % 2;
    const cellX = isLastOdd ? infoX : infoX + col * columnWidth;
    const cellY = y + row * rowHeight;
    const cellWidth = isLastOdd ? infoWidth : columnWidth;

    if (col === 1 && !isLastOdd) {
      drawReceiptDashedLine(context, cellX, cellY + 10, cellX, cellY + rowHeight - 10);
    }

    drawReceiptInfoCell(context, cell.kind, cell.label, cell.value, cellX, cellY, cellWidth, rowHeight);
  });

  return y + Math.ceil(cells.length / 2) * rowHeight;
};

const drawReceiptTable = (context: CanvasRenderingContext2D, rows: ReceiptItemRow[], y: number) => {
  const tableX = RECEIPT_CARD_X + RECEIPT_INSET;
  const tableWidth = RECEIPT_CARD_WIDTH - RECEIPT_INSET * 2;
  const headerHeight = 54;
  const qtyX = tableX + 52;
  const productX = tableX + 120;
  const totalRight = tableX + tableWidth - 42;
  const headerY = y;

  context.save();
  context.fillStyle = RECEIPT_NAVY;
  context.beginPath();
  context.moveTo(tableX, headerY + 8);
  context.lineTo(tableX + tableWidth, headerY + 2);
  context.lineTo(tableX + tableWidth - 10, headerY + headerHeight - 8);
  context.lineTo(tableX + 8, headerY + headerHeight - 2);
  context.closePath();
  context.fill();
  context.restore();

  drawText(context, "QTD.", qtyX, y + 14, {
    font: "italic 800 24px 'Arial Narrow', Arial, sans-serif",
    color: "#ffffff",
    align: "center",
  });
  drawText(context, "PRODUTO", productX, y + 14, {
    font: "italic 800 24px 'Arial Narrow', Arial, sans-serif",
    color: "#ffffff",
  });
  drawText(context, "TOTAL", totalRight, y + 14, {
    font: "italic 800 24px 'Arial Narrow', Arial, sans-serif",
    color: "#ffffff",
    align: "right",
  });

  let rowY = y + headerHeight;

  rows.forEach((row) => {
    const textTop = rowY + 18;
    const numberY = rowY + row.height / 2;

    drawText(context, String(row.item.quantity), qtyX, numberY, {
      font: "700 28px 'Arial Narrow', Arial, sans-serif",
      color: "#071126",
      align: "center",
      baseline: "middle",
    });

    let productY = textTop;
    row.productLines.forEach((line) => {
      drawText(context, line, productX, productY, {
        font: "700 28px 'Arial Narrow', Arial, sans-serif",
        color: "#071126",
      });
      productY += 32;
    });

    row.detailLines.forEach((line) => {
      drawText(context, line, productX, productY, {
        font: "600 20px Arial, sans-serif",
        color: RECEIPT_BLUE,
      });
      productY += 24;
    });

    drawText(context, formatCurrency(row.item.unitPrice * row.item.quantity), totalRight, numberY, {
      font: "700 27px 'Arial Narrow', Arial, sans-serif",
      color: "#071126",
      align: "right",
      baseline: "middle",
    });

    rowY += row.height;
    drawReceiptDashedLine(context, tableX, rowY, tableX + tableWidth, rowY);
  });

  return rowY;
};

const drawReceiptTotal = (context: CanvasRenderingContext2D, order: Order, y: number) => {
  const totals = calculateOrderTotals(order);
  const total = order.payment?.totalPaid ?? totals.total;
  const boxX = RECEIPT_CARD_X + RECEIPT_INSET;
  const boxWidth = RECEIPT_CARD_WIDTH - RECEIPT_INSET * 2;
  const boxHeight = RECEIPT_TOTAL_HEIGHT;

  fillRoundedRect(context, boxX, y, boxWidth, boxHeight, 12, RECEIPT_LIGHT_BLUE);
  strokeRoundedRect(context, boxX, y, boxWidth, boxHeight, 12, RECEIPT_BLUE, 2.5);
  drawText(context, "TOTAL DA COMANDA:", boxX + 46, y + boxHeight / 2, {
    font: "800 32px 'Arial Narrow', Arial, sans-serif",
    color: RECEIPT_NAVY,
    baseline: "middle",
  });
  drawText(context, formatCurrency(total), boxX + boxWidth - 42, y + boxHeight / 2, {
    font: "800 56px 'Arial Narrow', Arial, sans-serif",
    color: RECEIPT_BLUE,
    align: "right",
    baseline: "middle",
  });

  return y + boxHeight;
};

const drawReceiptPayment = (context: CanvasRenderingContext2D, order: Order, y: number) => {
  const payment = getPaymentMethodLabel(order);
  const statusLabel = getReceiptStatusLabel(order);
  const statusColor = getReceiptStatusColor(order);
  const boxX = RECEIPT_CARD_X + RECEIPT_INSET;
  const boxWidth = RECEIPT_CARD_WIDTH - RECEIPT_INSET * 2;
  const columnWidth = boxWidth / 2;
  const height = 94;

  drawReceiptDashedLine(context, boxX, y, boxX + boxWidth, y);

  if (payment) {
    drawReceiptIcon(context, "card", boxX + 28, y + 23);
    drawText(context, "FORMA DE PAGAMENTO:", boxX + 104, y + 25, {
      font: "900 24px Arial Black, sans-serif",
      color: RECEIPT_NAVY,
    });
    drawText(context, payment, boxX + 104, y + 56, {
      font: "700 25px Arial, sans-serif",
      color: "#071126",
    });
  }

  drawReceiptDashedLine(context, boxX + columnWidth, y + 14, boxX + columnWidth, y + height - 16);
  if (isPaidReceipt(order)) {
    drawReceiptCheck(context, boxX + columnWidth + 42, y + 22, 52, RECEIPT_BLUE);
  } else {
    drawReceiptIcon(context, "clock", boxX + columnWidth + 45, y + 24);
  }
  drawText(context, "SITUA\u00c7\u00c3O:", boxX + columnWidth + 118, y + 25, {
    font: "900 24px Arial Black, sans-serif",
    color: RECEIPT_NAVY,
  });
  drawText(context, statusLabel, boxX + columnWidth + 118, y + 56, {
    font: "900 25px Arial Black, sans-serif",
    color: statusColor,
  });

  return y + height;
};

const drawReceiptFooter = (context: CanvasRenderingContext2D, y: number) => {
  drawReceiptBrushBand(context, y, "OBRIGADO E VOLTE SEMPRE!", 64);
  return y + 64;
};

const drawPaidReceipt = (
  context: CanvasRenderingContext2D,
  order: Order,
  receiptRows: ReceiptItemRow[],
  logo: HTMLImageElement | null,
  canvasHeight: number,
) => {
  drawReceiptBackground(context, canvasHeight);
  drawReceiptLogo(context, logo);
  drawReceiptBrushBand(context, 558, "COMPROVANTE DE COMANDA", 76);

  const infoBottom = drawReceiptInfo(context, order, 684);
  const tableBottom = drawReceiptTable(context, receiptRows, infoBottom + 28);
  const totalBottom = drawReceiptTotal(context, order, tableBottom + 28);
  const paymentBottom = drawReceiptPayment(context, order, totalBottom + 24);
  drawReceiptFooter(context, paymentBottom + 24);
};

const measurePaidReceiptRows = (context: CanvasRenderingContext2D, order: Order): ReceiptItemRow[] =>
  order.items.map((item) => {
    const productLines = wrapText(context, item.productName, RECEIPT_PRODUCT_WIDTH, "700 27px Arial, sans-serif");
    const detailText = isPromotionalItem(item)
      ? `Promo\u00e7\u00e3o: ${formatCurrency(getOriginalPrice(item))} por ${formatCurrency(item.unitPrice)}`
      : "";
    const detailLines = detailText ? wrapText(context, detailText, RECEIPT_PRODUCT_WIDTH, "600 20px Arial, sans-serif") : [];
    const rowTextHeight = productLines.length * 32 + detailLines.length * 24;
    const height = Math.max(66, rowTextHeight + 22);

    return { item, productLines, detailLines, height };
  });

const getPaidReceiptInfoCellCount = (_order: Order) => 3;

const getPaidReceiptCanvasHeight = (order: Order, receiptRows: ReceiptItemRow[]) => {
  const infoBottom = RECEIPT_INFO_Y + Math.ceil(getPaidReceiptInfoCellCount(order) / 2) * 86;
  const tableBottom = infoBottom + 28 + 54 + receiptRows.reduce((sum, row) => sum + row.height, 0);
  const totalBottom = tableBottom + 28 + RECEIPT_TOTAL_HEIGHT;
  const paymentBottom = totalBottom + 24 + 94;
  const footerBottom = paymentBottom + 24 + 86;

  return Math.max(RECEIPT_MIN_HEIGHT, footerBottom + 72);
};

const drawPaidReceiptInfo = (context: CanvasRenderingContext2D, order: Order, y: number, assets?: ReceiptAssets) => {
  const infoX = RECEIPT_CARD_X + RECEIPT_INSET;
  const infoWidth = RECEIPT_CARD_WIDTH - RECEIPT_INSET * 2;
  const columnWidth = infoWidth / 2;
  const rowHeight = 86;
  const infoHeight = rowHeight * 2;
  const receiptDate = getReceiptDateSource(order);
  const customer = getReceiptCustomer(order);

  drawReceiptDashedLine(context, infoX, y - 14, infoX + infoWidth, y - 14);
  drawReceiptDashedLine(context, infoX, y + rowHeight - 1, infoX + columnWidth, y + rowHeight - 1);
  drawReceiptDashedLine(context, infoX, y + infoHeight - 1, infoX + infoWidth, y + infoHeight - 1);
  drawReceiptDashedLine(context, infoX + columnWidth, y + 8, infoX + columnWidth, y + infoHeight - 8);

  drawReceiptInfoCell(context, "calendar", "DATA:", formatShareDate(receiptDate), infoX, y, columnWidth, rowHeight, assets);
  drawReceiptInfoCell(context, "table", "MESA:", getMesaValue(order), infoX, y + rowHeight, columnWidth, rowHeight, assets);
  drawReceiptInfoCell(
    context,
    "user",
    "CLIENTE:",
    customer || "Cliente n\u00e3o informado",
    infoX + columnWidth + 34,
    y,
    columnWidth - 34,
    infoHeight,
    assets,
  );

  return y + infoHeight;
};

const drawPaidReceiptPayment = (context: CanvasRenderingContext2D, order: Order, y: number) => {
  const payment = getPaymentMethodLabel(order);
  const statusLabel = getReceiptStatusLabel(order);
  const statusColor = getReceiptStatusColor(order);
  const boxX = RECEIPT_CARD_X + RECEIPT_INSET;
  const boxWidth = RECEIPT_CARD_WIDTH - RECEIPT_INSET * 2;
  const columnWidth = boxWidth / 2;
  const height = 94;
  const labelY = y + 24;
  const valueY = y + 55;

  drawReceiptDashedLine(context, boxX, y, boxX + boxWidth, y);

  if (payment) {
    drawReceiptIcon(context, "card", boxX + 28, y + 22);
    drawText(context, "FORMA DE PAGAMENTO:", boxX + 104, labelY, {
      font: RECEIPT_META_LABEL_FONT,
      color: RECEIPT_NAVY,
    });
    drawText(context, payment, boxX + 104, valueY, {
      font: RECEIPT_META_VALUE_FONT,
      color: "#071126",
    });

    drawReceiptDashedLine(context, boxX + columnWidth, y + 14, boxX + columnWidth, y + height - 16);
    if (isPaidReceipt(order)) {
      drawReceiptCheck(context, boxX + columnWidth + 42, y + 22, 52, RECEIPT_BLUE);
    } else {
      drawReceiptIcon(context, "clock", boxX + columnWidth + 45, y + 24);
    }
    drawText(context, "SITUA\u00c7\u00c3O:", boxX + columnWidth + 118, labelY, {
      font: RECEIPT_META_LABEL_FONT,
      color: RECEIPT_NAVY,
    });
    drawText(context, statusLabel, boxX + columnWidth + 118, valueY, {
      font: RECEIPT_META_LABEL_FONT,
      color: statusColor,
    });
  } else {
    if (isPaidReceipt(order)) {
      drawReceiptCheck(context, boxX + boxWidth / 2 - 116, y + 22, 52, RECEIPT_BLUE);
    } else {
      drawReceiptIcon(context, "clock", boxX + boxWidth / 2 - 113, y + 24);
    }
    drawText(context, "SITUA\u00c7\u00c3O:", boxX + boxWidth / 2 - 42, labelY, {
      font: RECEIPT_META_LABEL_FONT,
      color: RECEIPT_NAVY,
    });
    drawText(context, statusLabel, boxX + boxWidth / 2 - 42, valueY, {
      font: RECEIPT_META_LABEL_FONT,
      color: statusColor,
    });
  }

  return y + height;
};

const drawPaidReceiptVisual = (
  context: CanvasRenderingContext2D,
  order: Order,
  receiptRows: ReceiptItemRow[],
  assets: ReceiptAssets,
  canvasHeight: number,
) => {
  drawReceiptBackground(context, canvasHeight, assets.background);
  drawReceiptLogo(context, assets.logo);
  drawReceiptTitleBandImage(context, assets.titleBand, RECEIPT_TITLE_Y, RECEIPT_TITLE_HEIGHT);

  const infoBottom = drawPaidReceiptInfo(context, order, RECEIPT_INFO_Y, assets);
  const tableBottom = drawReceiptTable(context, receiptRows, infoBottom + 28);
  const totalBottom = drawReceiptTotal(context, order, tableBottom + 28);
  const paymentBottom = drawPaidReceiptPayment(context, order, totalBottom + 24);
  drawReceiptThanksBandImage(context, assets.thanksBand, paymentBottom + 24, 70);
};

const createScaledCanvas = (canvasHeight: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH * RENDER_SCALE;
  canvas.height = canvasHeight * RENDER_SCALE;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Não foi possível gerar a imagem da comanda.");
  }

  context.scale(RENDER_SCALE, RENDER_SCALE);
  return { canvas, context };
};

const exportCanvasAtImageWidth = (sourceCanvas: HTMLCanvasElement, canvasHeight: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH;
  canvas.height = canvasHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Não foi possível preparar a imagem final.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, IMAGE_WIDTH, canvasHeight);

  return canvas;
};

const createPngFileFromCanvas = async (canvas: HTMLCanvasElement, order: Order) => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((imageBlob) => {
      if (imageBlob) {
        resolve(imageBlob);
        return;
      }

      reject(new Error("Nao foi possivel salvar a imagem da comanda."));
    }, "image/png");
  });

  return new File([blob], getOrderShareFileName(order), { type: "image/png" });
};

export const createOrderShareImageFile = async (order: Order, _legacyLogoSrc: string) => {
  await waitForFonts();

  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");

  if (!measureContext) {
    throw new Error("Não foi possível preparar a imagem da comanda.");
  }

  if (usesReceiptShareLayout(order)) {
    const receiptRows = measurePaidReceiptRows(measureContext, order);
    const canvasHeight = getPaidReceiptCanvasHeight(order, receiptRows);
    const [{ canvas, context }, assets] = await Promise.all([
      Promise.resolve(createScaledCanvas(canvasHeight)),
      loadReceiptAssets(),
    ]);

    drawPaidReceiptVisual(context, order, receiptRows, assets, canvasHeight);
    const finalCanvas = exportCanvasAtImageWidth(canvas, canvasHeight);
    return createPngFileFromCanvas(finalCanvas, order);
  }

  const rows = measureRows(measureContext, order);
  const listHeight = 68 + rows.reduce((sum, row) => sum + row.height, 0);
  const totalsHeight = calculateOrderTotals(order).serviceFee > 0 ? 250 : 196;
  const canvasHeight = Math.max(MIN_IMAGE_HEIGHT, 520 + listHeight + 58 + totalsHeight + 148);
  const [{ canvas, context }, logo, iconImages] = await Promise.all([
    Promise.resolve(createScaledCanvas(canvasHeight)),
    loadFirstImage(SHARE_LOGO_SOURCES),
    loadCategoryIconImages(rows),
  ]);

  drawBackground(context, canvasHeight);
  drawHeaderLogo(context, logo);

  drawText(context, "COMANDA", IMAGE_WIDTH / 2, 220, {
    font: "800 70px Impact, Arial Black, sans-serif",
    color: "#f7f7fb",
    align: "center",
    shadow: true,
  });

  drawInfoCard(context, order, 315);

  const listBottom = drawItemRows(context, rows, iconImages, 510);
  const totalsBottom = drawTotals(context, order, listBottom + 58);
  drawFooter(context, totalsBottom + 28);

  const finalCanvas = exportCanvasAtImageWidth(canvas, canvasHeight);
  const blob = await new Promise<Blob>((resolve, reject) => {
    finalCanvas.toBlob((imageBlob) => {
      if (imageBlob) {
        resolve(imageBlob);
        return;
      }

      reject(new Error("Não foi possível salvar a imagem da comanda."));
    }, "image/png");
  });

  return new File([blob], getOrderShareFileName(order), { type: "image/png" });
};

export const downloadOrderShareImage = (file: File) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
