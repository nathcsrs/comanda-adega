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
const FALLBACK_MESSAGE = "Olá! Segue sua comanda da Adega Tá no Grale.";
const FOOTER_MESSAGE = "Sua comanda é individual e não pode ser transferida.";
const NO_TABLE_LABEL = "Sem mesa";

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

export const createOrderShareImageFile = async (order: Order, _legacyLogoSrc: string) => {
  await waitForFonts();

  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");

  if (!measureContext) {
    throw new Error("Não foi possível preparar a imagem da comanda.");
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
