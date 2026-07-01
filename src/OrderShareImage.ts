import type { Order, OrderItem } from "./types";
import { calculateOrderTotals, formatCurrency } from "./utils";

const IMAGE_WIDTH = 1080;
const IMAGE_PADDING = 86;
const FALLBACK_MESSAGE = "Olá! Segue sua comanda da Adega Tá no Grale.";
const FOOTER_MESSAGE = "Sua comanda é individual e não pode ser transferida.";
const NO_TABLE_LABEL = "Sem mesa";

type MeasuredItemRow = {
  item: OrderItem;
  nameLines: string[];
  noteLines: string[];
  height: number;
};

const isPromotionalItem = (item: OrderItem) => {
  const originalPrice = item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice;
  return Boolean(item.promotion && originalPrice > item.unitPrice);
};

const getOriginalPrice = (item: OrderItem) => item.originalUnitPrice ?? item.promotion?.originalPrice ?? item.unitPrice;

const getOrderTitle = (order: Order) => {
  if (order.table === NO_TABLE_LABEL && order.customer?.trim()) {
    return order.customer.trim();
  }

  return order.table;
};

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

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

const setFont = (context: CanvasRenderingContext2D, font: string) => {
  context.font = font;
};

const wrapText = (context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string) => {
  setFont(context, font);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (context.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
      return;
    }

    lines.push(word);
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [text];
};

const measureRows = (context: CanvasRenderingContext2D, order: Order): MeasuredItemRow[] =>
  order.items.map((item) => {
    const nameLines = wrapText(context, item.productName.toUpperCase(), 468, "700 36px Impact, Arial Black, sans-serif");
    const noteLines = item.note ? wrapText(context, `Obs: ${item.note}`, 510, "600 25px Arial, sans-serif") : [];
    const promoHeight = isPromotionalItem(item) ? 42 : 0;
    const noteHeight = noteLines.length ? noteLines.length * 30 + 14 : 0;
    const nameHeight = nameLines.length * 43;
    const height = Math.max(120, 38 + nameHeight + promoHeight + noteHeight + 34);

    return { item, nameLines, noteLines, height };
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
    shadow?: boolean;
  },
) => {
  context.save();
  context.font = options.font;
  context.fillStyle = options.color;
  context.textAlign = options.align ?? "left";
  context.textBaseline = "top";

  if (options.shadow) {
    context.shadowColor = "rgba(0, 0, 0, 0.8)";
    context.shadowBlur = 8;
    context.shadowOffsetY = 4;
  }

  context.fillText(text, x, y);
  context.restore();
};

const drawStruckPrice = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
) => {
  drawText(context, text, x, y, { font, color });
  context.save();
  context.font = font;
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(x, y + 17);
  context.lineTo(x + context.measureText(text).width, y + 17);
  context.stroke();
  context.restore();
};

const drawHeaderLogo = (
  context: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  y: number,
) => {
  if (!logo) {
    drawText(context, "ADEGA TÁ NO GRALE", IMAGE_WIDTH / 2, y + 68, {
      font: "800 56px Arial Black, Impact, sans-serif",
      color: "#ffd447",
      align: "center",
      shadow: true,
    });
    return;
  }

  const logoWidth = 420;
  const logoHeight = (logo.height / logo.width) * logoWidth;
  context.save();
  context.shadowColor = "rgba(37, 212, 255, 0.32)";
  context.shadowBlur = 28;
  context.drawImage(logo, (IMAGE_WIDTH - logoWidth) / 2, y, logoWidth, logoHeight);
  context.restore();
};

const drawInfoCard = (context: CanvasRenderingContext2D, order: Order, y: number) => {
  const cardX = 132;
  const cardWidth = IMAGE_WIDTH - cardX * 2;
  const borderGradient = context.createLinearGradient(cardX, y, cardX + cardWidth, y);
  borderGradient.addColorStop(0, "#22c8ff");
  borderGradient.addColorStop(0.52, "#6b4dff");
  borderGradient.addColorStop(1, "#d743ff");

  fillRoundedRect(context, cardX, y, cardWidth, 226, 28, "rgba(10, 12, 18, 0.86)");
  strokeRoundedRect(context, cardX, y, cardWidth, 226, 28, borderGradient, 4);

  drawText(context, "COMANDA", IMAGE_WIDTH / 2, y + 34, {
    font: "800 64px Impact, Arial Black, sans-serif",
    color: "#f7f7fb",
    align: "center",
    shadow: true,
  });

  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.15)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(cardX + 34, y + 112);
  context.lineTo(cardX + cardWidth - 34, y + 112);
  context.stroke();
  context.restore();

  const title = getOrderTitle(order);
  const infoTop = y + 138;
  const columnGap = 42;
  const firstX = cardX + 72;
  const secondX = cardX + 330;
  const thirdX = cardX + 600;

  drawText(context, "MESA", firstX, infoTop, {
    font: "800 29px Arial Black, sans-serif",
    color: "#bf63ff",
  });
  drawText(context, title.replace(/^Mesa\s*/i, "") || title, firstX, infoTop + 34, {
    font: "800 45px Arial Black, Impact, sans-serif",
    color: "#ffffff",
    shadow: true,
  });

  drawText(context, "DATA", secondX, infoTop, {
    font: "800 29px Arial Black, sans-serif",
    color: "#24cfff",
  });
  drawText(context, formatShareDate(order.openedAt), secondX, infoTop + 36, {
    font: "800 34px Arial Black, sans-serif",
    color: "#ffffff",
    shadow: true,
  });

  drawText(context, "HORA", thirdX, infoTop, {
    font: "800 29px Arial Black, sans-serif",
    color: "#24cfff",
  });
  drawText(context, formatShareTime(order.openedAt), thirdX, infoTop + 36, {
    font: "800 34px Arial Black, sans-serif",
    color: "#ffffff",
    shadow: true,
  });

  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.18)";
  context.lineWidth = 2;
  [secondX - columnGap, thirdX - columnGap].forEach((lineX) => {
    context.beginPath();
    context.moveTo(lineX, infoTop - 4);
    context.lineTo(lineX, infoTop + 84);
    context.stroke();
  });
  context.restore();
};

const drawItemRows = (
  context: CanvasRenderingContext2D,
  rows: MeasuredItemRow[],
  y: number,
) => {
  const listX = 122;
  const listWidth = IMAGE_WIDTH - listX * 2;
  const headerHeight = 76;
  const listHeight = headerHeight + rows.reduce((sum, row) => sum + row.height, 0);

  fillRoundedRect(context, listX, y, listWidth, listHeight, 22, "rgba(5, 7, 12, 0.82)");

  const headerGradient = context.createLinearGradient(listX, y, listX + listWidth, y);
  headerGradient.addColorStop(0, "rgba(126, 52, 164, 0.88)");
  headerGradient.addColorStop(1, "rgba(61, 24, 93, 0.88)");
  fillRoundedRect(context, listX, y, listWidth, headerHeight, 22, headerGradient);

  drawText(context, "ITEM", listX + 34, y + 24, {
    font: "700 29px Arial Black, Impact, sans-serif",
    color: "#ffffff",
  });
  drawText(context, "QTD", listX + 620, y + 24, {
    font: "700 29px Arial Black, Impact, sans-serif",
    color: "#ffffff",
    align: "center",
  });
  drawText(context, "TOTAL", listX + listWidth - 42, y + 24, {
    font: "700 29px Arial Black, Impact, sans-serif",
    color: "#ffffff",
    align: "right",
  });

  let rowY = y + headerHeight;
  rows.forEach((row, index) => {
    const { item } = row;
    const total = item.unitPrice * item.quantity;
    const rowMidY = rowY + 38;

    if (index > 0) {
      context.save();
      context.strokeStyle = "rgba(255, 255, 255, 0.15)";
      context.setLineDash([10, 8]);
      context.beginPath();
      context.moveTo(listX + 28, rowY);
      context.lineTo(listX + listWidth - 28, rowY);
      context.stroke();
      context.restore();
    }

    context.save();
    context.strokeStyle = isPromotionalItem(item) ? "#ffd447" : "#9b48ff";
    context.lineWidth = 5;
    context.beginPath();
    context.arc(listX + 58, rowMidY + 24, 22, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    let textY = rowY + 28;
    row.nameLines.forEach((line) => {
      drawText(context, line, listX + 100, textY, {
        font: "700 36px Impact, Arial Black, sans-serif",
        color: "#f7f7fb",
        shadow: true,
      });
      textY += 43;
    });

    if (isPromotionalItem(item)) {
      const original = formatCurrency(getOriginalPrice(item));
      drawStruckPrice(context, original, listX + 100, textY + 2, "700 25px Arial, sans-serif", "#9ca6b8");
      drawText(context, formatCurrency(item.unitPrice), listX + 252, textY, {
        font: "800 28px Arial Black, sans-serif",
        color: "#ffd447",
      });
      fillRoundedRect(context, listX + 412, textY - 4, 148, 34, 17, "rgba(255, 212, 71, 0.16)");
      drawText(context, item.promotion?.name?.toUpperCase() || "PROMOÇÃO", listX + 486, textY + 4, {
        font: "800 17px Arial Black, sans-serif",
        color: "#ffd447",
        align: "center",
      });
      textY += 42;
    }

    row.noteLines.forEach((line) => {
      drawText(context, line, listX + 100, textY, {
        font: "600 25px Arial, sans-serif",
        color: "#b9c9d8",
      });
      textY += 30;
    });

    drawText(context, String(item.quantity), listX + 620, rowY + 40, {
      font: "800 38px Arial Black, sans-serif",
      color: "#ffffff",
      align: "center",
      shadow: true,
    });

    drawText(context, formatCurrency(total), listX + listWidth - 42, rowY + 40, {
      font: "800 33px Arial Black, sans-serif",
      color: "#ffffff",
      align: "right",
      shadow: true,
    });

    rowY += row.height;
  });

  strokeRoundedRect(context, listX, y, listWidth, listHeight, 22, "rgba(36, 207, 255, 0.18)", 2);

  return y + listHeight;
};

const drawTotals = (context: CanvasRenderingContext2D, order: Order, y: number) => {
  const totals = calculateOrderTotals(order);
  const totalGradient = context.createLinearGradient(0, y, IMAGE_WIDTH, y);
  totalGradient.addColorStop(0, "#22c8ff");
  totalGradient.addColorStop(1, "#9f45ff");

  context.save();
  context.strokeStyle = "#9f45ff";
  context.setLineDash([12, 10]);
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(IMAGE_PADDING, y);
  context.lineTo(IMAGE_WIDTH - IMAGE_PADDING, y);
  context.stroke();
  context.restore();

  let currentY = y + 48;
  drawText(context, "Subtotal", IMAGE_PADDING + 10, currentY, {
    font: "700 32px Arial, sans-serif",
    color: "#c7d6e8",
  });
  drawText(context, formatCurrency(totals.subtotal), IMAGE_WIDTH - IMAGE_PADDING - 10, currentY, {
    font: "800 36px Arial Black, sans-serif",
    color: "#ffffff",
    align: "right",
    shadow: true,
  });

  currentY += 54;

  if (totals.serviceFee > 0) {
    drawText(context, "Taxa de serviço", IMAGE_PADDING + 10, currentY, {
      font: "700 32px Arial, sans-serif",
      color: "#c7d6e8",
    });
    drawText(context, formatCurrency(totals.serviceFee), IMAGE_WIDTH - IMAGE_PADDING - 10, currentY, {
      font: "800 36px Arial Black, sans-serif",
      color: "#ffffff",
      align: "right",
      shadow: true,
    });
    currentY += 54;
  }

  drawText(context, "TOTAL", IMAGE_PADDING + 10, currentY + 16, {
    font: "800 50px Impact, Arial Black, sans-serif",
    color: "#ffffff",
    shadow: true,
  });
  drawText(context, formatCurrency(totals.total), IMAGE_WIDTH - IMAGE_PADDING - 10, currentY, {
    font: "800 66px Arial Black, Impact, sans-serif",
    color: totalGradient,
    align: "right",
    shadow: true,
  });

  return currentY + 108;
};

const drawFooter = (context: CanvasRenderingContext2D, y: number) => {
  const footerX = 128;
  const footerWidth = IMAGE_WIDTH - footerX * 2;
  fillRoundedRect(context, footerX, y, footerWidth, 104, 24, "rgba(255, 255, 255, 0.035)");
  strokeRoundedRect(context, footerX, y, footerWidth, 104, 24, "rgba(255, 255, 255, 0.09)", 2);

  drawText(context, "▣", footerX + 92, y + 29, {
    font: "800 44px Arial Black, sans-serif",
    color: "#ffd447",
    align: "center",
  });
  drawText(context, FOOTER_MESSAGE, IMAGE_WIDTH / 2 + 40, y + 36, {
    font: "700 26px Arial, sans-serif",
    color: "#ffffff",
    align: "center",
  });
};

export const createOrderShareImageFile = async (order: Order, logoSrc: string) => {
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");

  if (!measureContext) {
    throw new Error("Não foi possível preparar a imagem da comanda.");
  }

  const rows = measureRows(measureContext, order);
  const listHeight = 76 + rows.reduce((sum, row) => sum + row.height, 0);
  const totalsHeight = calculateOrderTotals(order).serviceFee > 0 ? 250 : 198;
  const canvasHeight = Math.max(1510, 560 + 226 + 52 + listHeight + 54 + totalsHeight + 150);
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH;
  canvas.height = canvasHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Não foi possível gerar a imagem da comanda.");
  }

  const background = context.createLinearGradient(0, 0, IMAGE_WIDTH, canvasHeight);
  background.addColorStop(0, "#04050a");
  background.addColorStop(0.38, "#111024");
  background.addColorStop(0.72, "#061923");
  background.addColorStop(1, "#030407");
  context.fillStyle = background;
  context.fillRect(0, 0, IMAGE_WIDTH, canvasHeight);

  context.save();
  context.globalAlpha = 0.28;
  for (let x = 0; x < IMAGE_WIDTH; x += 58) {
    context.strokeStyle = x % 116 === 0 ? "rgba(36, 207, 255, 0.16)" : "rgba(255, 255, 255, 0.04)";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + canvasHeight * 0.16, canvasHeight);
    context.stroke();
  }
  context.restore();

  fillRoundedRect(context, 36, 30, IMAGE_WIDTH - 72, canvasHeight - 60, 28, "rgba(255, 255, 255, 0.025)");

  const logo = await loadImage(logoSrc);
  drawHeaderLogo(context, logo, 54);

  const infoY = 454;
  drawInfoCard(context, order, infoY);

  const listBottom = drawItemRows(context, rows, infoY + 278);
  const totalsBottom = drawTotals(context, order, listBottom + 48);
  drawFooter(context, totalsBottom + 28);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((imageBlob) => {
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
