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
const sidebarInput = document.getElementById("sidebar-input");
const sendBtn = document.getElementById("send-btn");
const sidebarSendBtn = document.getElementById("sidebar-send-btn");
const toggleBtn = document.getElementById("toggle-btn");
const chatList = document.getElementById("chat-list");
const viewerCount = document.getElementById("viewer-count");
const sidebarViewerCount = document.getElementById("sidebar-viewer-count");

const seedDanmaku = [
  "之前也玩apex洛克王国",
  "我真玩我160多级",
  "这波属实在大气层",
  "哈哈哈哈绷不住了",
  "懂了，但又没完全懂",
  "建议纳入梗百科词条",
  "主播这句话信息量过大",
  "节目效果直接拉满",
  "有画面了兄弟们",
  "别急，让子弹飞一会儿",
  "这不是梗，这是互联网化石",
  "建议直接接入 AI 开讲"
];

const chatSeeds = [
  ["鹤观", "Win11是他强迫我更新的，好像是我C了"],
  ["鹤观", "对啊"],
  ["鹤观", "🤣🤣"],
  ["人生得意徐尽欢", "看着我的，没动了"],
  ["高育良", "这句已经能单开词条了"],
  ["质数.", "这弹幕区是懂总结的"],
  ["小王同学", "建议直接点梗解释试试"],
  ["用户HDD知识常乐的", "我感觉这就是经典回旋镖"]
];

const explainTemplates = [
  {
    title: "这是在用一句话浓缩全场情绪",
    desc: "这类弹幕往往不是逐字解释，而是把现场的离谱、好笑、熟悉感一次性打包发出来。观众一看就懂，属于互联网语境下的高速共鸣。",
    note: "后续接入 AI 时，可以把这条弹幕与前后聊天、主播发言一起分析，解释会更像真的“梗百科条目”。"
  },
  {
    title: "这是典型的弹幕区集体玩梗",
    desc: "它的重点不在字面意思，而在于“大家为什么此刻突然都觉得这句话特别贴脸”。弹幕其实是在给当前画面贴标签，顺便完成一次会心一笑。",
    note: "下一步可以让 AI 输出：梗来源、常见使用场景、适合什么时候刷，以及一句风趣总结。"
  },
  {
    title: "这是观众在做高密度阅读理解",
    desc: "看起来只有短短一句，实际上里面塞了态度、判断和情绪。能在直播间里迅速流行，说明这条弹幕已经精准踩中了当前画面的笑点。",
    note: "如果接真实模型，这里还可以顺便告诉用户：这是老梗、新梗，还是直播间现场生成的临时梗。"
  }
];

const colorPalette = ["#ffffff", "#fff7ba", "#ffd4e2", "#bde6ff", "#e0d2ff", "#d7ffd6"];
const avatarPalette = ["#8db7ff", "#ff9fc2", "#ffe08a", "#9effda", "#c3b0ff"];

let isPaused = false;
let selectedNode = null;
let loopTimer = null;
let chatTimer = null;
let laneCooldowns = [];
let laneCount = 8;
let currentViewers = 14;

function getLaneMetrics() {
  const stageHeight = danmakuStage.clientHeight || 520;
  const rowHeight = window.innerWidth < 720 ? 40 : 48;
  laneCount = Math.max(5, Math.floor(stageHeight / rowHeight));
  laneCooldowns = Array.from({ length: laneCount }, (_, index) => laneCooldowns[index] || 0);
  return { stageHeight, rowHeight };
}

function pickLane() {
  const now = Date.now();
  const freeIndex = laneCooldowns.findIndex((v) => v <= now);
  if (freeIndex !== -1) return freeIndex;

  let minIndex = 0;
  for (let i = 1; i < laneCooldowns.length; i += 1) {
    if (laneCooldowns[i] < laneCooldowns[minIndex]) minIndex = i;
  }
  return minIndex;
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function syncViewerCount() {
  viewerCount.textContent = String(currentViewers);
  sidebarViewerCount.textContent = String(currentViewers);
}

function bumpViewerCount() {
  currentViewers = clamp(currentViewers + (Math.random() > 0.5 ? 1 : -1), 12, 29);
  syncViewerCount();
}

function createChatMessage(name, text, badge = "") {
  const item = document.createElement("div");
  item.className = "chat-item";

  const avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.textContent = name.slice(0, 1);
  avatar.style.background = `linear-gradient(135deg, ${randomFrom(avatarPalette)}, ${randomFrom(avatarPalette)})`;

  const body = document.createElement("div");
  body.className = "chat-body";

  const meta = document.createElement("div");
  meta.className = "chat-meta";

  const nameNode = document.createElement("span");
  nameNode.className = "chat-name";
  nameNode.textContent = name;

  meta.appendChild(nameNode);

  if (badge) {
    const badgeNode = document.createElement("span");
    badgeNode.className = "chat-badge";
    badgeNode.textContent = badge;
    meta.appendChild(badgeNode);
  }

  const content = document.createElement("div");
  content.textContent = text;

  body.append(meta, content);
  item.append(avatar, body);
  chatList.appendChild(item);
  chatList.scrollTop = chatList.scrollHeight;

  while (chatList.children.length > 18) {
    chatList.removeChild(chatList.firstElementChild);
  }
}

function hidePopover() {
  danmakuPopover.classList.add("is-hidden");
  danmakuPopover.setAttribute("aria-hidden", "true");
}

function hideModal() {
  explainModal.classList.add("is-hidden");
  explainModal.setAttribute("aria-hidden", "true");
}

function clearSelection() {
  if (selectedNode) {
    selectedNode.classList.remove("is-selected", "is-frozen");
  }
  selectedNode = null;
  hidePopover();
  hideModal();
}

function showPopoverNear(node) {
  const frameRect = playerFrame.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();

  danmakuPopover.classList.remove("is-hidden");
  danmakuPopover.setAttribute("aria-hidden", "false");

  const width = danmakuPopover.offsetWidth || 220;
  const height = danmakuPopover.offsetHeight || 58;

  const left = clamp(
    nodeRect.left - frameRect.left + nodeRect.width / 2 - width / 2,
    14,
    frameRect.width - width - 14
  );

  let top = nodeRect.top - frameRect.top + nodeRect.height + 12;
  if (top + height > frameRect.height - 20) {
    top = nodeRect.top - frameRect.top - height - 12;
  }

  danmakuPopover.style.left = `${left}px`;
  danmakuPopover.style.top = `${clamp(top, 14, frameRect.height - height - 14)}px`;
}

function showModal(text) {
  const explain = randomFrom(explainTemplates);
  modalSourceText.textContent = text;
  modalTitle.textContent = explain.title;
  modalDesc.textContent = `“${text}” 这条弹幕本质上是在给当前直播画面做快速总结。${explain.desc}`;
  modalNote.textContent = explain.note;
  explainModal.classList.remove("is-hidden");
  explainModal.setAttribute("aria-hidden", "false");
}

function selectDanmaku(node) {
  if (selectedNode && selectedNode !== node) {
    selectedNode.classList.remove("is-selected", "is-frozen");
  }
  selectedNode = node;
  selectedNode.classList.add("is-selected", "is-frozen");
  hideModal();
  showPopoverNear(node);
}

function createDanmaku(text, source = "自动弹幕") {
  const { stageHeight, rowHeight } = getLaneMetrics();
  const lane = pickLane();
  const top = Math.max(16, lane * rowHeight + 24);
  const duration = Number((7.5 + Math.random() * 5).toFixed(2));
  laneCooldowns[lane] = Date.now() + Math.max(900, duration * 210);

  const node = document.createElement("button");
  node.type = "button";
  node.className = "danmaku-item";
  node.textContent = text;
  node.title = "点击查看梗解释";
  node.style.top = `${Math.min(top, stageHeight - rowHeight - 60)}px`;
  node.style.setProperty("--duration", `${duration}s`);
  node.style.color = randomFrom(colorPalette);
  node.dataset.text = text;
  node.dataset.source = source;

  if (isPaused) node.classList.add("is-paused");

  node.addEventListener("click", (event) => {
    event.stopPropagation();
    selectDanmaku(node);
  });

  node.addEventListener("animationend", () => {
    if (selectedNode === node) clearSelection();
    node.remove();
  });

  danmakuStage.appendChild(node);
}

function startDanmakuLoop() {
  clearInterval(loopTimer);
  loopTimer = window.setInterval(() => {
    if (isPaused) return;
    createDanmaku(randomFrom(seedDanmaku));
  }, 760);
}

function startChatLoop() {
  clearInterval(chatTimer);
  chatTimer = window.setInterval(() => {
    const [name, text] = randomFrom(chatSeeds);
    createChatMessage(name, text, Math.random() > 0.7 ? "27" : "");
    if (Math.random() > 0.55) bumpViewerCount();
  }, 1800);
}

function bootstrap() {
  syncViewerCount();
  getLaneMetrics();

  for (let i = 0; i < 10; i += 1) {
    window.setTimeout(() => createDanmaku(randomFrom(seedDanmaku), "初始弹幕"), i * 220);
  }

  chatSeeds.slice(0, 6).forEach(([name, text], index) => {
    window.setTimeout(() => createChatMessage(name, text, index % 2 === 0 ? "27" : ""), index * 120);
  });

  startDanmakuLoop();
  startChatLoop();
}

function submitMessage(text) {
  const value = text.trim();
  if (!value) return false;

  createDanmaku(value, "手动发送");
  createChatMessage("你", value, "发送");
  bumpViewerCount();
  return true;
}

sendBtn.addEventListener("click", () => {
  if (submitMessage(customInput.value)) {
    customInput.value = "";
    sidebarInput.value = "";
    customInput.focus();
  }
});

sidebarSendBtn.addEventListener("click", () => {
  if (submitMessage(sidebarInput.value || customInput.value)) {
    customInput.value = "";
    sidebarInput.value = "";
    sidebarInput.focus();
  }
});

[customInput, sidebarInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (submitMessage(input.value)) {
        customInput.value = "";
        sidebarInput.value = "";
        input.focus();
      }
    }
  });
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

modalCloseBtn.addEventListener("click", hideModal);

modalRefreshBtn.addEventListener("click", () => {
  if (!selectedNode) return;
  showModal(selectedNode.dataset.text || "这条弹幕");
});

explainModal.addEventListener("click", (event) => {
  if (event.target === explainModal) hideModal();
});

playerFrame.addEventListener("click", (event) => {
  const insidePopover = danmakuPopover.contains(event.target);
  const insideModalCard = event.target.closest(".explain-card");
  if (!insidePopover && !insideModalCard) clearSelection();
});

window.addEventListener("resize", () => {
  getLaneMetrics();
  if (selectedNode) showPopoverNear(selectedNode);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") clearSelection();
});

bootstrap();
