const title = document.getElementById("title");
const message = document.getElementById("message");
const destinationLabel = document.getElementById("destination-label");
const reflectionText = document.getElementById("reflection-text");
const backButton = document.getElementById("back-button");
const closeButton = document.getElementById("close-button");

const params = new URLSearchParams(window.location.search);
const attemptedUrl = params.get("url") || "";
const reasonType = params.get("reasonType") || "site";
const reasonValue = params.get("reasonValue") || "this site";
const reasonLabel = params.get("reasonLabel") || reasonValue;
const source = params.get("source") || "manual-list";

const passages = [
  {
    title: "This is not what you actually wanted.",
    message:
      "You were probably not reaching for this tab because it would leave you clearer, calmer, or more complete. You were reaching for relief that lasts a few seconds and steals more than it gives. The cost is subtle at first: a fractured attention span, a shallower mind, a day that feels busy but remains untouched by real progress.",
    reflection:
      "If you protect this hour, what meaningful thing becomes easier tonight?"
  },
  {
    title: "A craving is not a command.",
    message:
      "What feels urgent right now may only be habit asking to be fed. Habit always speaks in the language of immediacy. It says now, quickly, just for a moment. But your future is shaped by what you repeat, not by what you intend. Opening this site again would rehearse the same small surrender.",
    reflection:
      "What would it look like to choose your values before your impulses?"
  },
  {
    title: "Attention is part of your life, not a disposable resource.",
    message:
      "Every distraction asks for something finite: your ability to stay with difficulty long enough for depth to appear. Once that attention is broken, you do not simply lose minutes. You lose continuity, seriousness, and the chance to become fully absorbed in something worthy of you.",
    reflection:
      "What important task is waiting on the other side of this avoided discomfort?"
  }
];

const selection = passages[Math.floor(Math.random() * passages.length)];

title.textContent = selection.title;
message.textContent = selection.message;
reflectionText.textContent = selection.reflection;
destinationLabel.textContent = describeDestination(attemptedUrl, reasonLabel);
appendReasonMessage();

backButton.addEventListener("click", () => {
  window.history.back();
});

closeButton.addEventListener("click", async () => {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (currentTab?.id) {
    await chrome.tabs.remove(currentTab.id);
  }
});

function describeDestination(url, fallbackSite) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return fallbackSite;
  }
}

function appendReasonMessage() {
  const reasonText =
    reasonType === "limit"
      ? `Stillness blocked this site because you hit its daily time limit.`
      : reasonType === "category"
        ? `Stillness flagged this page as ${reasonLabel.toLowerCase()} using a local ${source.replaceAll("-", " ")} check.`
        : `Stillness matched this destination against your manual block list.`;

  message.textContent = `${selection.message} ${reasonText}`;
}
