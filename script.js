const playerFrame = document.getElementById("player-frame");
const danmakuStage = document.getElementById("danmaku-stage");
const danmakuPopover = document.getElementById("danmaku-popover");
const popoverExplainBtn = document.getElementById("popover-explain-btn");
const popoverCloseBtn = document.getElementById("popover-close-btn");
const explainModal = document.getElementById("explain-modal");
const modalCloseBtn = document.getElementById("modal-close-btn");
const modalRefreshBtn = document.getElementById("modal-refresh-btn");
const modalSourceText = document.getElementById("modal-source-text");
const modalTitle = document.getElementById("explain-title");
const modalDesc = document.getElementById("modal-desc");
const modalNote = document.getElementById("modal-note");
const customInput = document.getElementById("custom-input");
const sendBtn = document.getElementById("send-btn");
const toggleBtn = document.getElementById("toggle-btn");

const seedDanmaku = [
  "前方高能预警！",
  "这波属实在大气层",
  "哈哈哈哈绷不住了",
  "懂了，但又没完全懂",
  "建议纳入梗百科词条",
  "主播这句话信息量过大",
  "这就是传说中的节目效果吗",
  "笑死，根本停不下来",
  "这个梗我奶奶都学会了",
  "别急，让子弹飞一会儿",
  "这弹幕区是懂总结的",
  "属于是经典永流传了",
  "这不是梗，这是互联网化石",
  "我愿称之为阅读理解满分",
  "好家伙，已经开始复盘了",
  "有画面了兄弟们",
  "这一句能单开一页解释",
  "建议直接接入 AI 开讲",
  "我宣布这条弹幕赢了",
  "节目效果直接拉满"
];

const colorPalette = [
  "#ffffff",
  "#ffe082",
  "#ffb3c7",
  "#9ae6ff",
  "#cbb6ff",
  "#b6ffcf"
];

const explainTemplates = [
  {
    title: "这是在说“离谱到上天”",
    desc: "这类弹幕通常用来形容某个操作、发言或剧情发展已经突破常规理解范围，仿佛直接冲上大气层。翻译成人话就是：这也太秀、太离谱、太有节目效果了吧。",
    note: "后续接 AI 时，可以结合直播上下文、前后弹幕和主播发言，把“为什么大家突然刷这个梗”解释得更完整。"
  },
  {
    title: "这是典型的“互联网会心一笑”",
    desc: "当观众觉得眼前这一幕自带名场面气质时，就会用一句简短又有梗味的弹幕完成集体共鸣。它不一定是字面解释，更像是弹幕区在同步喊：懂的都懂！",
    note: "真实接入 AI 后，可以输出梗的来源、常见用法、适用语境，甚至顺手补一句带点幽默感的吐槽。"
  },
  {
    title: "这是在给当前画面贴‘梗标签’",
    desc: "很多弹幕梗本质上是一种高速概括：观众看到一个熟悉的情境，就立刻用一句圈内黑话把情绪、态度和笑点全打包发出来，所以传播效率极高。",
    note: "后续可以让 AI 不只解释字面意思，还顺便判断这条弹幕是在玩梗、夸张调侃，还是在做观众共创。"
  }
];

let isPaused = false;
let selectedNode = null;
let loopTimer = null;
let laneCooldowns = [];
let laneCount = 8;

function getLaneMetrics() {
  const stageHeight = danmakuStage.clientHeight || 520;
  const rowHeight = window.innerWidth < 720 ? 42 : 52;
  laneCount = Math.max(5, Math.floor(stageHeight / rowHeight));
  laneCooldowns = Array.from({ length: laneCount }, (_, index) => laneCooldowns[index] || 0);
  return { stageHeight, rowHeight };
}

function pickLane() {
  const now = Date.now();
  const availableLane = laneCooldowns.findIndex((value) => value <= now);

  if (availableLane !== -1) {
    return availableLane;
  }

  let earliestLane = 0;
  for (let i = 1; i < laneCooldowns.length; i += 1) {
    if (laneCooldowns[i] < laneCooldowns[earliestLane]) {
      earliestLane = i;
    }
  }
  return earliestLane;
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hidePopover() {
  danmakuPopover.classList.add("is-hidden");
  danmakuPopover.setAttribute("aria-hidden", "true");
}

function showPopoverNear(node) {
  const frameRect = playerFrame.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();

  danmakuPopover.classList.remove("is-hidden");
  danmakuPopover.setAttribute("aria-hidden", "false");

  const popoverWidth = danmakuPopover.offsetWidth || 220;
  const popoverHeight = danmakuPopover.offsetHeight || 64;

  const left = clamp(
    nodeRect.left - frameRect.left + nodeRect.width / 2 - popoverWidth / 2,
    16,
    frameRect.width - popoverWidth - 16
  );

  let top = nodeRect.top - frameRect.top + nodeRect.height + 14;
  if (top + popoverHeight > frameRect.height - 24) {
    top = nodeRect.top - frameRect.top - popoverHeight - 14;
  }
  top = clamp(top, 16, frameRect.height - popoverHeight - 16);

  danmakuPopover.style.left = `${left}px`;
  danmakuPopover.style.top = `${top}px`;
}

function hideModal() {
  explainModal.classList.add("is-hidden");
  explainModal.setAttribute("aria-hidden", "true");
}

function showModal(text) {
  const explain = randomFrom(explainTemplates);
  modalSourceText.textContent = text;
  modalTitle.textContent = explain.title;
  modalDesc.textContent = `“${text}” 这条弹幕常常不是在逐字翻译，而是在用最短的话把全场的情绪总结出来。${explain.desc}`;
  modalNote.textContent = explain.note;
  explainModal.classList.remove("is-hidden");
  explainModal.setAttribute("aria-hidden", "false");
}

function clearSelection() {
  if (selectedNode) {
    selectedNode.classList.remove("is-selected");
    selectedNode.classList.remove("is-frozen");
  }

  selectedNode = null;
  hidePopover();
  hideModal();
}

function selectDanmaku(node) {
  if (selectedNode === node) {
    showPopoverNear(node);
    return;
  }

  if (selectedNode) {
    selectedNode.classList.remove("is-selected");
    selectedNode.classList.remove("is-frozen");
  }

  selectedNode = node;
  selectedNode.classList.add("is-selected");
  selectedNode.classList.add("is-frozen");

  hideModal();
  showPopoverNear(node);
}

function createDanmaku(text, source = "自动弹幕") {
  const { stageHeight, rowHeight } = getLaneMetrics();
  const lane = pickLane();
  const top = Math.max(10, lane * rowHeight + 10);
  const duration = Number((7.5 + Math.random() * 5.5).toFixed(2));
  const coolDown = Math.max(950, duration * 220);

  laneCooldowns[lane] = Date.now() + coolDown;

  const node = document.createElement("button");
  node.type = "button";
  node.className = "danmaku-item";
  node.textContent = text;
  node.title = "点击打开梗解释操作";
  node.style.top = `${Math.min(top, stageHeight - rowHeight)}px`;
  node.style.setProperty("--duration", `${duration}s`);
  node.style.color = randomFrom(colorPalette);

  node.dataset.text = text;
  node.dataset.lane = String(lane);
  node.dataset.duration = String(duration);
  node.dataset.source = source;

  if (isPaused) {
    node.classList.add("is-paused");
  }

  node.addEventListener("click", (event) => {
    event.stopPropagation();
    selectDanmaku(node);
  });

  node.addEventListener("animationend", () => {
    if (selectedNode === node) {
      clearSelection();
    }
    node.remove();
  });

  danmakuStage.appendChild(node);
}

function startLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
  }

  loopTimer = window.setInterval(() => {
    if (isPaused) return;
    createDanmaku(randomFrom(seedDanmaku), "自动弹幕");
  }, 780);
}

function bootstrapDanmaku() {
  getLaneMetrics();
  for (let i = 0; i < 10; i += 1) {
    window.setTimeout(() => {
      createDanmaku(randomFrom(seedDanmaku), "初始弹幕");
    }, i * 220);
  }
  startLoop();
}

sendBtn.addEventListener("click", () => {
  const text = customInput.value.trim();
  if (!text) {
    customInput.focus();
    return;
  }

  createDanmaku(text, "手动发送");
  customInput.value = "";
  customInput.focus();
});

customInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendBtn.click();
  }
});

toggleBtn.addEventListener("click", () => {
  isPaused = !isPaused;
  toggleBtn.textContent = isPaused ? "继续飘屏" : "暂停飘屏";

  document.querySelectorAll(".danmaku-item").forEach((node) => {
    node.classList.toggle("is-paused", isPaused);
  });
});

popoverExplainBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!selectedNode) return;
  showModal(selectedNode.dataset.text || "这条弹幕");
});

popoverCloseBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  clearSelection();
});

modalCloseBtn.addEventListener("click", () => {
  hideModal();
});

modalRefreshBtn.addEventListener("click", () => {
  if (!selectedNode) return;
  showModal(selectedNode.dataset.text || "这条弹幕");
});

explainModal.addEventListener("click", (event) => {
  if (event.target === explainModal) {
    hideModal();
  }
});

playerFrame.addEventListener("click", (event) => {
  const clickInsideDanmaku = selectedNode && selectedNode.contains(event.target);
  const clickInsidePopover = danmakuPopover.contains(event.target);
  const clickInsideModal = explainModal.contains(event.target) && event.target !== explainModal;

  if (!clickInsideDanmaku && !clickInsidePopover && !clickInsideModal) {
    clearSelection();
  }
});

window.addEventListener("resize", () => {
  getLaneMetrics();
  if (selectedNode) {
    showPopoverNear(selectedNode);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    clearSelection();
  }
});

bootstrapDanmaku();