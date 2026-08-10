export type InfoOSPageWindow = {
  page: number;
  start: number;
  end: number;
};

export function renderInfoOSPagination(
  parent: HTMLElement,
  total: number,
  current: number,
  onPage: (page: number) => void,
  ariaLabel = "分页"
): InfoOSPageWindow {
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, current), pages);
  const controls = parent.createDiv({ cls: "infoos-pagination", attr: { "aria-label": ariaLabel } });
  const previous = controls.createEl("button", { text: "上一页", attr: { type: "button" } });
  previous.disabled = page === 1;
  previous.addEventListener("click", () => onPage(page - 1));

  let last = 0;
  for (const number of visiblePageNumbers(page, pages)) {
    if (number - last > 1) controls.createSpan({ text: "…", cls: "infoos-pagination-gap" });
    const button = controls.createEl("button", {
      text: String(number),
      cls: number === page ? "is-active" : "",
      attr: {
        type: "button",
        "aria-label": `第 ${number} 页`,
        "aria-current": number === page ? "page" : "false"
      }
    });
    button.addEventListener("click", () => onPage(number));
    last = number;
  }

  const next = controls.createEl("button", { text: "下一页", attr: { type: "button" } });
  next.disabled = page === pages;
  next.addEventListener("click", () => onPage(page + 1));
  return { page, start: (page - 1) * pageSize, end: page * pageSize };
}

function visiblePageNumbers(current: number, total: number): number[] {
  const numbers = new Set([1, total]);
  for (let number = Math.max(1, current - 2); number <= Math.min(total, current + 2); number += 1) {
    numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b);
}
