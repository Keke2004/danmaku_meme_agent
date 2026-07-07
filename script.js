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
const modalStatus = document.getElementById("modal-status");
const suggestionActions = document.getElementById("suggestion-actions");
const respondTriggerBtn = document.getElementById("respond-trigger-btn");
const explainReadyBubble = document.getElementById("explain-ready-bubble");
const customInput = document.getElementById("custom-input");
const sidebarInput = document.getElementById("sidebar-input");
const sendBtn = document.getElementById("send-btn");
const sidebarSendBtn = document.getElementById("sidebar-send-btn");
const toggleBtn = document.getElementById("toggle-btn");
const chatList = document.getElementById("chat-list");
const sidebarViewerCount = document.getElementById("sidebar-viewer-count");
const heatPill = document.getElementById("heat-pill");
const hotwordStatus = document.getElementById("hotword-status");
const hotwordList = document.getElementById("hotword-list");
const noticeBox = document.querySelector(".notice-box");
const popoverExplainIcon = popoverExplainBtn.querySelector(".popover-icon");
const popoverExplainLabel = popoverExplainBtn.querySelector(".popover-label");
const popoverCloseIcon = popoverCloseBtn.querySelector(".popover-close-icon");
const popoverCloseLabel = popoverCloseBtn.querySelector(".popover-close-label");

const APP_CONFIG = Object.freeze({
  apiBase: window.DANMAKU_API_BASE || "http://127.0.0.1:8000",
  streamerId: "default",
  username: "你",
  model: "openai/gpt-5-chat"
});

const REQUEST_TIMEOUT_MS = 30000;
const EXPLAIN_TIMEOUT_MS = 70000;
const RESPOND_TIMEOUT_MS = 50000;
const FALLBACK_TEXT = "梗小虎还没学会这个梗，正在努力修行中……";

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

const aiExplainRules = [
  {
    pattern: /信息量过大/,
    responses: [
      "这句是在吐槽一句话里塞了太多内容",
      "意思是主播这波发言值得逐帧拆解",
      "这是观众在说：别急，我脑子还在加载"
    ]
  },
  {
    pattern: /互联网化石/,
    responses: [
      "这是在说这个梗老到像网络考古现场",
      "意思是这梗资历太深，已经快进博物馆了",
      "这类说法通常是在调侃：老网民 DNA 动了"
    ]
  },
  {
    pattern: /懂了.*没完全懂|没完全懂/,
    responses: [
      "意思是好像理解了，但细想又有点玄",
      "这是经典的半懂文学：懂了一层，没懂全部",
      "通常用来表达：我跟上了气氛，但没完全跟上逻辑"
    ]
  },
  {
    pattern: /让子弹飞一会儿/,
    responses: [
      "通常是在说先别急着下结论，等等后续",
      "意思是这事还没发酵完，先继续观察",
      "这句更像弹幕区在提醒大家：剧情还会反转"
    ]
  },
  {
    pattern: /大气层/,
    responses: [
      "是在夸这波理解或操作已经领先一个版本",
      "意思是这句评价站得比现场还高一层",
      "通常用于形容有人看问题已经飞到高维了"
    ]
  },
  {
    pattern: /绷不住/,
    responses: [
      "就是说这画面太好笑，情绪已经憋不住了",
      "意思是观众的表情管理当场失效",
      "这类弹幕通常对应直播间突然爆笑的瞬间"
    ]
  }
];

const aiExplainFallbacks = [
  "这句弹幕是在快速总结当前直播气氛",
  "这更像是观众在用一句话给现场贴标签",
  "简单说，就是大家在高浓度共鸣玩梗",
  "它不是逐字解释，而是在帮全场提炼笑点"
];

const colorPalette = ["#ffffff", "#fff7ba", "#ffd4e2", "#bde6ff", "#e0d2ff", "#d7ffd6"];
const suggestionMeta = [
  { key: "safe", label: "稳妥版", cls: "is-safe" },
  { key: "humorous", label: "幽默版", cls: "is-humorous" },
  { key: "interactive", label: "互动版", cls: "is-interactive" }
];

let isPaused = false;
let isExplainLoading = false;
let selectedNode = null;
let loopTimer = null;
let chatTimer = null;
let laneCooldowns = [];
let laneCount = 8;
let currentViewers = 14;
let lastAiExplainAt = 0;
let activeExplainRequestId = 0;
let activeExplainAbortController = null;
let activeRespondAbortController = null;
let isRespondLoading = false;
let isPopoverHiddenWhileThinking = false;
let pendingRespondPlan = null;
let modalMorphTimer = null;
const MORPH_PREPARE_MS = 260;
const MORPH_DURATION_MS = 700;

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

function truncateHotwordText(text, maxChars = 10) {
  const source = String(text || "").trim();
  if (!source) return "（空）";
  const chars = Array.from(source);
  if (chars.length <= maxChars) return source;
  return `${chars.slice(0, maxChars).join("")}…`;
}

function resolveApiUrl(path) {
  const base = APP_CONFIG.apiBase.replace(/\/$/, "");
  return `${base}${path}`;
}

function syncViewerCount() {
  if (sidebarViewerCount) {
    sidebarViewerCount.textContent = String(currentViewers);
  }
}

function bumpViewerCount() {
  currentViewers = clamp(currentViewers + (Math.random() > 0.5 ? 1 : -1), 12, 29);
  syncViewerCount();
}

function updateNotice(message, level = "info") {
  if (!noticeBox) return;
  noticeBox.textContent = message;
  noticeBox.dataset.level = level;
}

function createChatMessage(name, text, badge = "") {
  const item = document.createElement("div");
  item.className = "chat-item";

  const level = document.createElement("div");
  level.className = "chat-level";

  if (badge === "发送") {
    level.classList.add("is-action");
    level.textContent = "发";
  } else if (badge === "AI") {
    level.classList.add("is-ai");
    level.textContent = "AI";
  } else {
    level.textContent = badge || String(Math.floor(Math.random() * 35) + 1);
  }

  const body = document.createElement("div");
  body.className = "chat-body";

  const line = document.createElement("div");
  line.className = "chat-line";

  const nameNode = document.createElement("span");
  nameNode.className = "chat-name";
  nameNode.textContent = name;

  const separator = document.createElement("span");
  separator.className = "chat-separator";
  separator.textContent = "：";

  const textNode = document.createElement("span");
  textNode.className = "chat-text";
  textNode.textContent = text;

  line.append(nameNode, separator, textNode);
  body.appendChild(line);
  item.append(level, body);
  chatList.appendChild(item);
  chatList.scrollTop = chatList.scrollHeight;

  while (chatList.children.length > 20) {
    chatList.removeChild(chatList.firstElementChild);
  }
}

function setModalStatus(text, level = "info") {
  modalStatus.textContent = text;
  modalStatus.dataset.level = level;
}

function sleepMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hideReadyBubble() {
  explainReadyBubble.classList.add("is-hidden");
}

function showReadyBubble(text) {
  const compactText = String(text || "").slice(0, 14);
  explainReadyBubble.textContent = compactText
    ? `梗解释已就绪：${compactText}`
    : "梗解释已就绪，点击查看";
  explainReadyBubble.classList.remove("is-hidden");
}

function setPopoverCloseMode(mode = "close") {
  if (mode === "hide") {
    if (popoverCloseIcon) popoverCloseIcon.textContent = "−";
    if (popoverCloseLabel) popoverCloseLabel.textContent = "隐藏";
    popoverCloseBtn.title = "隐藏思考按钮，不中断请求";
    return;
  }

  if (popoverCloseIcon) popoverCloseIcon.textContent = "×";
  if (popoverCloseLabel) popoverCloseLabel.textContent = "关闭";
  popoverCloseBtn.title = "";
}

function setPopoverExplainState(state = "idle") {
  danmakuPopover.classList.remove("is-thinking", "is-expanded");
  popoverExplainBtn.classList.remove("is-thinking");
  setPopoverCloseMode("close");

  if (state === "thinking") {
    danmakuPopover.classList.add("is-thinking");
    popoverExplainBtn.classList.add("is-thinking");
    if (popoverExplainIcon) popoverExplainIcon.textContent = "⏳";
    if (popoverExplainLabel) popoverExplainLabel.textContent = "梗小虎正在思考中";
    popoverExplainBtn.title = "再次点击可取消梗解释";
    setPopoverCloseMode("hide");
    return;
  }

  if (state === "expanded") {
    danmakuPopover.classList.add("is-expanded");
    if (popoverExplainIcon) popoverExplainIcon.textContent = "✓";
    if (popoverExplainLabel) popoverExplainLabel.textContent = "梗解释已完成";
    popoverExplainBtn.title = "";
    return;
  }

  if (popoverExplainIcon) popoverExplainIcon.textContent = "✨";
  if (popoverExplainLabel) popoverExplainLabel.textContent = "梗解释";
  popoverExplainBtn.title = "";
}

function setRespondButtonState({ disabled = true, loading = false, label = "回梗" } = {}) {
  respondTriggerBtn.disabled = disabled;
  respondTriggerBtn.textContent = label;
  respondTriggerBtn.classList.toggle("is-loading", loading);
}

function resetSuggestionActions(message = "解释完成后，点击“回梗”获取建议") {
  suggestionActions.innerHTML = `<button type="button" class="suggestion-btn" disabled>${message}</button>`;
}

function hidePopover() {
  danmakuPopover.classList.add("is-hidden");
  danmakuPopover.setAttribute("aria-hidden", "true");
}

function clearModalMorphState() {
  if (modalMorphTimer) {
    window.clearTimeout(modalMorphTimer);
    modalMorphTimer = null;
  }

  explainModal.classList.remove("is-morphing", "is-morph-start");
  explainModal.style.removeProperty("--morph-translate-x");
  explainModal.style.removeProperty("--morph-translate-y");
  explainModal.style.removeProperty("--morph-scale-x");
  explainModal.style.removeProperty("--morph-scale-y");
}

function hideModal() {
  clearModalMorphState();
  explainModal.classList.add("is-hidden");
  explainModal.setAttribute("aria-hidden", "true");
}

function clearSelection() {
  cancelExplainFlow("已取消本次梗解释", { keepPopover: false });
  cancelRespondFlow("已取消本次回梗", { keepStatus: false });

  if (selectedNode) {
    selectedNode.classList.remove("is-selected", "is-frozen", "hotword-item--active");
  }
  isPopoverHiddenWhileThinking = false;
  pendingRespondPlan = null;
  selectedNode = null;
  hideReadyBubble();
  hidePopover();
  hideModal();
  resetSuggestionActions();
  setRespondButtonState({ disabled: true, loading: false, label: "回梗" });
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

function renderHotwords(topCandidates = [], triggered = false) {
  if (heatPill) {
    if (!topCandidates.length) {
      heatPill.textContent = "热度待机";
      heatPill.classList.remove("is-hot", "is-warm");
    } else {
      const leader = topCandidates[0];
      heatPill.textContent = triggered
        ? `热词爆发：${leader.word} × ${leader.count}`
        : `热词：${leader.word} × ${leader.count}`;
      heatPill.classList.toggle("is-hot", triggered);
      heatPill.classList.toggle("is-warm", !triggered);
    }
  }

  if (!hotwordList || !hotwordStatus) return;

  if (!topCandidates.length) {
    hotwordStatus.textContent = "暂无统计";
    hotwordList.innerHTML = '<li class="hotword-empty">发送弹幕后，这里显示 Top 5 高频词</li>';
    return;
  }

  hotwordStatus.textContent = triggered ? "热度阈值已触发" : "持续监测中";
  hotwordList.innerHTML = "";

  topCandidates.slice(0, 5).forEach((item, idx) => {
    const rawWord = String(item?.word || "").trim();
    const displayWord = truncateHotwordText(rawWord, 10);
    const li = document.createElement("li");
    li.className = "hotword-item";
    li.dataset.text = rawWord;
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.setAttribute("aria-label", `点击解释热词 ${rawWord || "（空）"}`);
    li.title = rawWord ? `点击解释：${rawWord}` : "点击解释：空文本";

    const rankSpan = document.createElement("span");
    rankSpan.className = "hotword-rank";
    rankSpan.textContent = String(idx + 1);

    const wordSpan = document.createElement("span");
    wordSpan.className = "hotword-word";
    wordSpan.textContent = displayWord;
    if (rawWord) {
      wordSpan.title = rawWord;
    }

    const countStrong = document.createElement("strong");
    countStrong.className = "hotword-count";
    countStrong.textContent = String(item?.count ?? 0);

    li.append(rankSpan, wordSpan, countStrong);

    li.addEventListener("click", (event) => {
      event.stopPropagation();
      selectHotword(li);
    });

    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectHotword(li);
      }
    });

    hotwordList.appendChild(li);
  });
}

async function requestJson(path, payload, options = {}) {
  const timeoutMs = Number(options.timeoutMs || REQUEST_TIMEOUT_MS);
  const externalSignal = options.signal || null;
  const controller = new AbortController();
  let abortedByTimeout = false;
  let detachExternalAbort = null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const onExternalAbort = () => controller.abort();
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      detachExternalAbort = () => externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }

  const timer = window.setTimeout(() => {
    abortedByTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response;
    try {
      response = await fetch(resolveApiUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        if (externalSignal?.aborted && !abortedByTimeout) {
          throw new Error("请求已取消");
        }
        throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}秒）`);
      }
      throw error;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail || data.error?.message || `请求失败（${response.status}）`;
      throw new Error(detail);
    }
    return data;
  } finally {
    window.clearTimeout(timer);
    if (detachExternalAbort) detachExternalAbort();
  }
}

async function checkBackendHealth() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(resolveApiUrl("/health"), { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    updateNotice("点击弹幕即可获得真实梗解释与回梗建议。", "success");
    setModalStatus("状态：后端在线", "success");
  } catch (error) {
    updateNotice("后端暂未连通，当前可继续体验弹幕；点击梗解释会使用本地兜底。", "warn");
    setModalStatus("状态：后端离线（可稍后重试）", "warn");
    console.warn("[health]", error);
  } finally {
    window.clearTimeout(timer);
  }
}

async function syncDanmakuToBackend(content, username) {
  try {
    const data = await requestJson("/api/danmaku/stream", {
      streamer_id: APP_CONFIG.streamerId,
      username,
      content
    });
    renderHotwords(data.top_candidates || [], Boolean(data.triggered));
  } catch (error) {
    console.warn("[danmaku/stream]", error);
    if (hotwordStatus) {
      hotwordStatus.textContent = "热词更新失败";
    }
  }
}

function showModalLoading(text) {
  modalSourceText.textContent = text;
  modalTitle.textContent = "梗解释";
  modalDesc.textContent = "正在联网检索并生成解释，请稍候…";
  modalNote.textContent = "解释完成后，可点击“回梗”生成建议。";
  setModalStatus("状态：正在请求梗解释", "loading");
  resetSuggestionActions("解释完成后，点击“回梗”获取建议");
  setRespondButtonState({ disabled: true, loading: false, label: "回梗" });
}

function showModalWithCurrentContent() {
  explainModal.classList.remove("is-hidden");
  explainModal.setAttribute("aria-hidden", "false");
  hideReadyBubble();
}

function buildAiDanmakuExplain(text) {
  const normalizedText = String(text || "").trim();

  for (const rule of aiExplainRules) {
    if (rule.pattern.test(normalizedText)) {
      return randomFrom(rule.responses);
    }
  }

  return randomFrom(aiExplainFallbacks);
}

function buildFallbackSuggestions(text) {
  const compact = String(text || "这梗").slice(0, 12);
  return {
    safe: `${compact}我先稳住`,
    humorous: `${compact}这波我学到了`,
    interactive: `${compact}还有谁会讲？`
  };
}

function emitBotBroadcast(text) {
  const content = String(text || "").trim();
  if (!content) return;

  const now = Date.now();
  if (now - lastAiExplainAt < 900) return;

  lastAiExplainAt = now;
  createDanmaku(`机器人：${content}`, "AI广播", { variant: "ai", clickable: false });
  createChatMessage("梗小虎", content, "AI");
}

function renderSuggestionActions(sourceText, suggestions, isFallback = false) {
  suggestionActions.innerHTML = "";

  suggestionMeta.forEach(({ key, label, cls }) => {
    const text = String(suggestions?.[key] || "").trim();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `suggestion-btn ${cls}`;

    if (!text) {
      btn.disabled = true;
      btn.textContent = `${label}：暂无`;
    } else {
      btn.textContent = `${label}：${text}`;
      btn.addEventListener("click", () => {
        const sent = submitMessage(text, {
          source: isFallback ? "本地兜底建议" : "AI建议",
          userName: APP_CONFIG.username,
          chatBadge: "发送",
          pushBackend: true,
          clickable: true,
          variant: "default"
        });
        if (sent) {
          setModalStatus(`状态：已发送${label}`, "success");
          emitBotBroadcast(`已推送${label}，继续刷 ${sourceText} 相关弹幕`);
        }
      });
    }

    suggestionActions.appendChild(btn);
  });
}

function cancelExplainFlow(reason = "已取消本次梗解释", options = {}) {
  const { keepPopover = false, keepStatus = true } = options;
  if (!isExplainLoading) return false;

  activeExplainRequestId += 1;
  if (activeExplainAbortController && !activeExplainAbortController.signal.aborted) {
    activeExplainAbortController.abort();
  }

  activeExplainAbortController = null;
  isExplainLoading = false;
  isPopoverHiddenWhileThinking = false;
  setPopoverExplainState("idle");
  if (keepStatus) setModalStatus(`状态：${reason}`, "warn");
  if (!keepPopover) hidePopover();

  return true;
}

function cancelRespondFlow(reason = "已取消本次回梗", options = {}) {
  const { keepStatus = true } = options;
  if (activeRespondAbortController && !activeRespondAbortController.signal.aborted) {
    activeRespondAbortController.abort();
  }
  activeRespondAbortController = null;
  isRespondLoading = false;
  if (keepStatus) setModalStatus(`状态：${reason}`, "warn");
}

function hideThinkingPopover() {
  if (!isExplainLoading) return;
  isPopoverHiddenWhileThinking = true;
  hidePopover();
  setModalStatus("状态：已隐藏思考按钮，解释完成后右上角提醒", "info");
}

function prepareExplainModalResult({
  selectedText,
  explanation,
  note,
  statusText,
  statusLevel,
  respondMode
}) {
  modalSourceText.textContent = selectedText;
  modalTitle.textContent = "梗解释";
  modalDesc.textContent = explanation;
  modalNote.textContent = String(note || "");
  setModalStatus(String(statusText || ""), statusLevel);
  resetSuggestionActions("点击“回梗”获取主播回梗建议");
  setRespondButtonState({ disabled: false, loading: false, label: "回梗" });
  pendingRespondPlan = {
    mode: respondMode,
    selectedText,
    explanation
  };
}

async function revealModalAfterThinking(reqId) {
  if (!selectedNode) return;

  setPopoverExplainState("expanded");
  showPopoverNear(selectedNode);
  await sleepMs(MORPH_PREPARE_MS);
  if (reqId !== activeExplainRequestId) return;

  const sourceRect = danmakuPopover.getBoundingClientRect();
  hidePopover();
  setPopoverExplainState("idle");
  showModalWithCurrentContent();

  const modalCard = explainModal.querySelector(".explain-card");
  if (!modalCard || !sourceRect.width || !sourceRect.height) return;

  clearModalMorphState();
  const cardRect = modalCard.getBoundingClientRect();
  if (!cardRect.width || !cardRect.height) return;

  const sourceCenterX = sourceRect.left + sourceRect.width / 2;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const targetCenterX = cardRect.left + cardRect.width / 2;
  const targetCenterY = cardRect.top + cardRect.height / 2;

  explainModal.style.setProperty("--morph-translate-x", `${sourceCenterX - targetCenterX}px`);
  explainModal.style.setProperty("--morph-translate-y", `${sourceCenterY - targetCenterY}px`);
  explainModal.style.setProperty("--morph-scale-x", `${sourceRect.width / cardRect.width}`);
  explainModal.style.setProperty("--morph-scale-y", `${sourceRect.height / cardRect.height}`);

  explainModal.classList.add("is-morphing", "is-morph-start");
  void modalCard.offsetWidth;
  window.requestAnimationFrame(() => {
    explainModal.classList.remove("is-morph-start");
  });

  modalMorphTimer = window.setTimeout(() => {
    clearModalMorphState();
  }, MORPH_DURATION_MS);
}

async function runExplainFlow(text) {
  const selectedText = String(text || "").trim();
  if (!selectedText) return;
  if (isExplainLoading) return;

  cancelRespondFlow("已取消上一条回梗请求", { keepStatus: false });
  pendingRespondPlan = null;
  hideReadyBubble();

  const reqId = ++activeExplainRequestId;
  const requestController = new AbortController();
  activeExplainAbortController = requestController;
  isExplainLoading = true;
  isPopoverHiddenWhileThinking = false;

  showModalLoading(selectedText);
  setPopoverExplainState("thinking");
  if (selectedNode) showPopoverNear(selectedNode);
  setModalStatus("状态：梗小虎正在思考中，再次点击可取消，或点隐藏", "loading");
  hideModal();

  try {
    const explainData = await requestJson(
      "/api/meme/explain",
      {
        streamer_id: APP_CONFIG.streamerId,
        barrage: selectedText,
        model: APP_CONFIG.model
      },
      { timeoutMs: EXPLAIN_TIMEOUT_MS, signal: requestController.signal }
    );

    if (reqId !== activeExplainRequestId) return;

    prepareExplainModalResult({
      selectedText,
      explanation: explainData.explanation || FALLBACK_TEXT,
      note: "",
      statusText: "",
      statusLevel: explainData.found ? "success" : "warn",
      respondMode: "api"
    });

    emitBotBroadcast(explainData.bot_broadcast || explainData.explanation || "");
    if (isPopoverHiddenWhileThinking) {
      setPopoverExplainState("idle");
      hidePopover();
      showReadyBubble(selectedText);
      setModalStatus("", "success");
    } else {
      await revealModalAfterThinking(reqId);
    }
  } catch (error) {
    if (reqId !== activeExplainRequestId) return;
    if (error.message === "请求已取消") return;

    const fallbackExplain = buildAiDanmakuExplain(selectedText);
    prepareExplainModalResult({
      selectedText,
      explanation: `后端请求失败，先给你一个本地解释：${fallbackExplain}`,
      note: "请检查后端服务、网络或密钥配置后重试；点击“回梗”将使用本地建议。",
      statusText: `状态：请求失败，已本地兜底（${error.message}）`,
      statusLevel: "error",
      respondMode: "local"
    });
    if (isPopoverHiddenWhileThinking) {
      setPopoverExplainState("idle");
      hidePopover();
      showReadyBubble(selectedText);
    } else {
      await revealModalAfterThinking(reqId);
    }

    console.warn("[explain/respond]", error);
  } finally {
    if (reqId === activeExplainRequestId) {
      isExplainLoading = false;
      activeExplainAbortController = null;
      isPopoverHiddenWhileThinking = false;
      setPopoverExplainState("idle");
    }
  }
}

async function runRespondFlow() {
  if (!pendingRespondPlan || isRespondLoading) return;

  const plan = pendingRespondPlan;
  isRespondLoading = true;
  setRespondButtonState({ disabled: true, loading: true, label: "回梗中..." });
  resetSuggestionActions("回梗建议生成中…");
  setModalStatus("状态：正在生成回梗建议", "loading");

  try {
    let respondData;
    if (plan.mode === "api") {
      const controller = new AbortController();
      activeRespondAbortController = controller;
      respondData = await requestJson(
        "/api/meme/respond",
        {
          streamer_id: APP_CONFIG.streamerId,
          barrage: plan.selectedText,
          explanation: plan.explanation || FALLBACK_TEXT,
          model: APP_CONFIG.model
        },
        { timeoutMs: RESPOND_TIMEOUT_MS, signal: controller.signal }
      );
    } else {
      await sleepMs(260);
      respondData = buildFallbackSuggestions(plan.selectedText);
    }

    if (plan !== pendingRespondPlan) return;

    renderSuggestionActions(plan.selectedText, respondData, plan.mode !== "api");
    setModalStatus("状态：回梗建议已生成，可一键发送", "success");
  } catch (error) {
    if (error.message === "请求已取消") return;
    if (plan !== pendingRespondPlan) return;

    renderSuggestionActions(plan.selectedText, buildFallbackSuggestions(plan.selectedText), true);
    setModalStatus(`状态：回梗请求失败，已本地兜底（${error.message}）`, "error");
    console.warn("[meme/respond]", error);
  } finally {
    if (plan === pendingRespondPlan) {
      isRespondLoading = false;
      activeRespondAbortController = null;
      setRespondButtonState({ disabled: false, loading: false, label: "重新回梗" });
    }
  }
}

function selectSourceNode(node, sourceType = "danmaku") {
  if (!node) return;

  if (isExplainLoading) {
    cancelExplainFlow("已切换目标，已取消上一条梗解释", { keepPopover: false, keepStatus: false });
  }
  cancelRespondFlow("已切换目标，已取消上一条回梗请求", { keepStatus: false });
  pendingRespondPlan = null;
  isPopoverHiddenWhileThinking = false;
  hideReadyBubble();
  resetSuggestionActions();
  setRespondButtonState({ disabled: true, loading: false, label: "回梗" });

  if (selectedNode && selectedNode !== node) {
    selectedNode.classList.remove("is-selected", "is-frozen", "hotword-item--active");
  }

  selectedNode = node;
  selectedNode.classList.add("is-selected");
  if (sourceType === "danmaku") {
    selectedNode.classList.add("is-frozen");
  } else if (sourceType === "hotword") {
    selectedNode.classList.add("hotword-item--active");
  }

  setPopoverExplainState("idle");
  hideModal();
  showPopoverNear(node);
}

function selectDanmaku(node) {
  selectSourceNode(node, "danmaku");
}

function selectHotword(node) {
  const text = String(node?.dataset?.text || "").trim();
  if (!text) return;
  updateNotice(`已选中热词「${text}」，可和弹幕一样点击“梗解释”触发。`, "info");
  selectSourceNode(node, "hotword");
}

function createDanmaku(text, source = "自动弹幕", options = {}) {
  const { variant = "default", clickable = true } = options;
  const { stageHeight, rowHeight } = getLaneMetrics();
  const lane = pickLane();
  const top = Math.max(16, lane * rowHeight + 24);
  const duration = Number((15 + Math.random() * 5).toFixed(2));
  laneCooldowns[lane] = Date.now() + Math.max(900, duration * 210);

  const node = document.createElement("button");
  node.type = "button";
  node.className = "danmaku-item";
  node.textContent = text;
  node.title = clickable ? "点击查看梗解释" : "";
  node.style.top = `${Math.min(top, stageHeight - rowHeight - 60)}px`;
  node.style.setProperty("--duration", `${duration}s`);
  node.dataset.text = text;
  node.dataset.source = source;
  node.dataset.variant = variant;

  if (variant === "ai") {
    node.classList.add("danmaku-item--ai");
  } else {
    node.style.color = randomFrom(colorPalette);
  }

  if (!clickable) {
    node.classList.add("danmaku-item--passive");
    node.setAttribute("tabindex", "-1");
    node.setAttribute("aria-label", text);
  }

  if (isPaused) node.classList.add("is-paused");

  if (clickable) {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      selectDanmaku(node);
    });
  }

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
  }, 900);
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
  renderHotwords([], false);
  hideReadyBubble();
  resetSuggestionActions();
  setRespondButtonState({ disabled: true, loading: false, label: "回梗" });
  checkBackendHealth();

  for (let i = 0; i < 10; i += 1) {
    window.setTimeout(() => createDanmaku(randomFrom(seedDanmaku), "初始弹幕"), i * 220);
  }

  chatSeeds.slice(0, 6).forEach(([name, text], index) => {
    window.setTimeout(() => createChatMessage(name, text, index % 2 === 0 ? "27" : ""), index * 120);
  });

  startDanmakuLoop();
  startChatLoop();
}

function submitMessage(text, options = {}) {
  const value = String(text || "").trim();
  if (!value) return false;

  const {
    source = "手动发送",
    userName = APP_CONFIG.username,
    chatBadge = "发送",
    pushBackend = true,
    clickable = true,
    variant = "default"
  } = options;

  createDanmaku(value, source, { variant, clickable });
  createChatMessage(userName, value, chatBadge);
  bumpViewerCount();

  if (pushBackend) {
    syncDanmakuToBackend(value, userName);
  }

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

popoverExplainBtn.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (!selectedNode) return;

  if (isExplainLoading) {
    cancelExplainFlow("已取消本次梗解释", { keepPopover: true, keepStatus: true });
    setPopoverExplainState("idle");
    showPopoverNear(selectedNode);
    return;
  }

  const selectedText = selectedNode.dataset.text || "这条弹幕";
  await runExplainFlow(selectedText);
});

popoverCloseBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (isExplainLoading) {
    hideThinkingPopover();
    return;
  }
  clearSelection();
});

modalCloseBtn.addEventListener("click", hideModal);

modalRefreshBtn.addEventListener("click", async () => {
  if (!selectedNode || isExplainLoading || isRespondLoading) return;
  await runExplainFlow(selectedNode.dataset.text || "这条弹幕");
});

respondTriggerBtn.addEventListener("click", async () => {
  if (!pendingRespondPlan || isRespondLoading) return;
  await runRespondFlow();
});

explainReadyBubble.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!pendingRespondPlan) return;
  showModalWithCurrentContent();
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
  if (selectedNode && !danmakuPopover.classList.contains("is-hidden")) showPopoverNear(selectedNode);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") clearSelection();
});

bootstrap();
