// ==UserScript==
// @name         ntk devtools analysis unlock
// @namespace    ntk-debug
// @version      1.1.1
// @description  First-party debugging helper for ntk. Disables local DevTools blockers without touching fetch/localStorage/EventTarget prototypes.
// @include      *://sbxh*.com/*
// @include      *://*.sbxh*.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  "use strict";

  var DEBUG = false;
  var WINDOW = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
  var DOCUMENT = WINDOW.document;
  var EVENT_TARGET = WINDOW.EventTarget || EventTarget;
  var WARN_KEY = "ntk_dev_warn";
  var WARN_RESET_KEY = "ntk_dev_warn_reset_v2";

  function debugLog() {
    if (!DEBUG) return;
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[ntk-devtools-analysis]");
      (WINDOW.console || console).warn.apply(WINDOW.console || console, args);
    } catch (_) {}
  }

  function clearWarnState() {
    try { WINDOW.localStorage.removeItem(WARN_KEY); } catch (_) {}
    try { WINDOW.localStorage.removeItem(WARN_RESET_KEY); } catch (_) {}
  }

  function defineFixedWindowValue(name, value) {
    try {
      Object.defineProperty(WINDOW, name, {
        configurable: true,
        enumerable: false,
        get: function () { return value; },
        set: function () {},
      });
      return true;
    } catch (_) {
      try { WINDOW[name] = value; } catch (_) {}
      return false;
    }
  }

  function callListener(listener, self, event) {
    if (typeof listener === "function") return listener.call(self, event);
    if (listener && typeof listener.handleEvent === "function") return listener.handleEvent(event);
    return undefined;
  }

  function readCapture(options) {
    if (options === true) return true;
    if (!options || typeof options !== "object") return false;
    return !!options.capture;
  }

  function makeDisableDevtoolNoop() {
    var noop = function () { return noop; };
    try {
      Object.defineProperty(noop, "isSuspend", {
        configurable: false,
        enumerable: true,
        get: function () { return true; },
        set: function () {},
      });
    } catch (_) {
      noop.isSuspend = true;
    }
    noop.isRunning = false;
    noop.md5 = function () { return ""; };
    noop.version = "0.3.9";
    noop.DetectorType = {};
    noop.isDevToolOpened = function () { return false; };
    return noop;
  }

  function installDisableDevtoolNoop() {
    var noop = makeDisableDevtoolNoop();
    var stored = noop;

    try {
      if (WINDOW.DisableDevtool && typeof WINDOW.DisableDevtool === "function") {
        try { WINDOW.DisableDevtool.isSuspend = true; } catch (_) {}
      }
    } catch (_) {}

    try {
      Object.defineProperty(WINDOW, "DisableDevtool", {
        configurable: true,
        enumerable: false,
        get: function () { return stored; },
        set: function (value) {
          try {
            if (value && typeof value === "function") value.isSuspend = true;
          } catch (_) {}
          stored = noop;
          debugLog("ignored DisableDevtool assignment");
        },
      });
    } catch (_) {
      try { WINDOW.DisableDevtool = noop; } catch (_) {}
    }
  }

  function installPreflightBypass() {
    // DevToolsPreflight starts with:
    //   if (window.__ntkDevtoolsPreflight) return;
    defineFixedWindowValue("__ntkDevtoolsPreflight", 1);
    defineFixedWindowValue("__ntkDevtoolsTripped", undefined);
  }

  function isSuspiciousFormatter(formatter) {
    if (!formatter || typeof formatter !== "object") return false;
    var header = formatter.header;
    if (typeof header !== "function") return false;
    var source = "";
    try { source = (WINDOW.Function || Function).prototype.toString.call(header); } catch (_) {}
    return /formattersTripped|auto:formatters|autoTrip|ntkDevtools|DevToolsBlocker/i.test(source);
  }

  function installFormatterFilter() {
    var nativePush = ((WINDOW.Array || Array).prototype || Array.prototype).push;
    var stored = [];

    function appendClean(items) {
      var accepted = [];
      for (var i = 0; i < items.length; i += 1) {
        if (isSuspiciousFormatter(items[i])) {
          debugLog("dropped DevTools formatter probe");
        } else {
          accepted.push(items[i]);
        }
      }
      if (accepted.length) nativePush.apply(stored, accepted);
      return stored.length;
    }

    try {
      if (Array.isArray(WINDOW.devtoolsFormatters)) {
        appendClean(WINDOW.devtoolsFormatters);
      }
    } catch (_) {}

    try {
      Object.defineProperty(stored, "push", {
        configurable: true,
        writable: true,
        value: function () { return appendClean(arguments); },
      });
    } catch (_) {}

    try {
      Object.defineProperty(WINDOW, "devtoolsFormatters", {
        configurable: true,
        enumerable: false,
        get: function () { return stored; },
        set: function (value) {
          stored.length = 0;
          if (Array.isArray(value)) appendClean(value);
        },
      });
    } catch (_) {}
  }

  function isDevtoolsShortcut(event) {
    if (!event) return false;
    var key = String(event.key || "");
    var code = String(event.code || "").toLowerCase();
    var lower = key.toLowerCase();
    var meta = !!(event.ctrlKey || event.metaKey);
    if (key === "F12" || code === "f12") return true;
    if (meta && event.shiftKey && /^(i|j|c|k|e|m|p)$/i.test(lower)) return true;
    if (event.metaKey && event.altKey && /^(i|j|c|k|e|m|p)$/i.test(lower)) return true;
    if (meta && /^(u|s)$/i.test(lower)) return true;
    return false;
  }

  function stopPageHandlersOnly(event) {
    try { event.stopImmediatePropagation(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
  }

  function installEventShield(nativeAdd) {
    var opts = { capture: true, passive: false };

    function onKeyDown(event) {
      if (!isDevtoolsShortcut(event)) return;
      stopPageHandlersOnly(event);
      debugLog("allowed browser shortcut", event.key || event.code);
    }

    function onContextMenu(event) {
      stopPageHandlersOnly(event);
      debugLog("allowed contextmenu");
    }

    function onDragStart(event) {
      stopPageHandlersOnly(event);
      debugLog("allowed dragstart");
    }

    try { nativeAdd.call(WINDOW, "keydown", onKeyDown, opts); } catch (_) {}
    try { nativeAdd.call(DOCUMENT, "keydown", onKeyDown, opts); } catch (_) {}
    try { nativeAdd.call(WINDOW, "contextmenu", onContextMenu, opts); } catch (_) {}
    try { nativeAdd.call(DOCUMENT, "contextmenu", onContextMenu, opts); } catch (_) {}
    try { nativeAdd.call(WINDOW, "dragstart", onDragStart, opts); } catch (_) {}
    try { nativeAdd.call(DOCUMENT, "dragstart", onDragStart, opts); } catch (_) {}
  }

  function installEventRegistrationGuard(nativeAdd, nativeRemove) {
    var wrappedByTarget = typeof WeakMap === "function" ? new WeakMap() : null;

    function shouldWrap(type, listener, options) {
      if (!listener) return false;
      if (type === "keydown") return true;
      if ((type === "contextmenu" || type === "dragstart") && readCapture(options)) return true;
      return false;
    }

    function shouldSkip(type, event) {
      if (type === "keydown") return isDevtoolsShortcut(event);
      if (type === "contextmenu" || type === "dragstart") return true;
      return false;
    }

    function mapKey(target, type, options) {
      return (target === WINDOW ? "w:" : "d:") + type + ":" + (readCapture(options) ? "1" : "0");
    }

    function remember(listener, key, wrapped) {
      if (!wrappedByTarget || (typeof listener !== "function" && typeof listener !== "object")) return;
      var m = wrappedByTarget.get(listener);
      if (!m) {
        m = {};
        wrappedByTarget.set(listener, m);
      }
      m[key] = wrapped;
    }

    function recall(listener, key) {
      if (!wrappedByTarget || (typeof listener !== "function" && typeof listener !== "object")) return listener;
      var m = wrappedByTarget.get(listener);
      return (m && m[key]) || listener;
    }

    function guardedAdd(type, listener, options) {
      var t = String(type || "");
      if (!shouldWrap(t, listener, options)) return nativeAdd.call(this, type, listener, options);

      var target = this === WINDOW ? WINDOW : DOCUMENT;
      var key = mapKey(target, t, options);
      var existing = recall(listener, key);
      if (existing !== listener) return nativeAdd.call(this, type, existing, options);

      var wrapped = function (event) {
        if (shouldSkip(t, event)) {
          debugLog("skipped page listener", t, event && (event.key || event.code || event.type));
          return undefined;
        }
        return callListener(listener, this, event);
      };
      remember(listener, key, wrapped);
      return nativeAdd.call(this, type, wrapped, options);
    }

    function guardedRemove(type, listener, options) {
      var t = String(type || "");
      var target = this === WINDOW ? WINDOW : DOCUMENT;
      var key = mapKey(target, t, options);
      return nativeRemove.call(this, type, recall(listener, key), options);
    }

    try {
      Object.defineProperty(WINDOW, "addEventListener", {
        configurable: true,
        writable: true,
        value: guardedAdd,
      });
      Object.defineProperty(WINDOW, "removeEventListener", {
        configurable: true,
        writable: true,
        value: guardedRemove,
      });
    } catch (_) {
      try { WINDOW.addEventListener = guardedAdd; } catch (_) {}
      try { WINDOW.removeEventListener = guardedRemove; } catch (_) {}
    }

    try {
      Object.defineProperty(DOCUMENT, "addEventListener", {
        configurable: true,
        writable: true,
        value: guardedAdd,
      });
      Object.defineProperty(DOCUMENT, "removeEventListener", {
        configurable: true,
        writable: true,
        value: guardedRemove,
      });
    } catch (_) {
      try { DOCUMENT.addEventListener = guardedAdd; } catch (_) {}
      try { DOCUMENT.removeEventListener = guardedRemove; } catch (_) {}
    }
  }

  function findDescriptor(owner, prop) {
    var current = owner;
    while (current) {
      try {
        var descriptor = Object.getOwnPropertyDescriptor(current, prop);
        if (descriptor) return descriptor;
      } catch (_) {}
      try { current = Object.getPrototypeOf(current); } catch (_) { current = null; }
    }
    return null;
  }

  function nativeWindowNumberReader(prop) {
    var initial = 0;
    try { initial = Number(WINDOW[prop]) || 0; } catch (_) {}
    var descriptor = findDescriptor(WINDOW, prop);
    if (descriptor && typeof descriptor.get === "function") {
      return function () {
        try { return Number(descriptor.get.call(WINDOW)) || initial; } catch (_) { return initial; }
      };
    }
    return function () { return initial; };
  }

  function installViewportGapMask() {
    var readOuterWidth = nativeWindowNumberReader("outerWidth");
    var readOuterHeight = nativeWindowNumberReader("outerHeight");

    function maskedOuterWidth() {
      var outer = readOuterWidth();
      var inner = 0;
      try { inner = Number(WINDOW.innerWidth) || 0; } catch (_) {}
      if (outer > 0 && inner > 0 && outer - inner > 160) return inner + 80;
      return outer;
    }

    function maskedOuterHeight() {
      var outer = readOuterHeight();
      var inner = 0;
      try { inner = Number(WINDOW.innerHeight) || 0; } catch (_) {}
      if (outer > 0 && inner > 0 && outer - inner > 160) return inner + 80;
      return outer;
    }

    try {
      Object.defineProperty(WINDOW, "outerWidth", {
        configurable: true,
        enumerable: true,
        get: maskedOuterWidth,
      });
      Object.defineProperty(WINDOW, "outerHeight", {
        configurable: true,
        enumerable: true,
        get: maskedOuterHeight,
      });
    } catch (_) {
      debugLog("viewport gap mask unavailable");
    }
  }

  function installConsoleClearGuard() {
    var nativeClear = null;
    try {
      if (WINDOW.console && typeof WINDOW.console.clear === "function") nativeClear = WINDOW.console.clear.bind(WINDOW.console);
    } catch (_) {}
    try {
      Object.defineProperty(WINDOW.console || console, "clear", {
        configurable: true,
        writable: true,
        value: function () {},
      });
    } catch (_) {}
    try {
      Object.defineProperty(WINDOW, "__ntkNativeConsoleClear", {
        configurable: true,
        enumerable: false,
        value: function () {
          if (nativeClear) nativeClear();
        },
      });
    } catch (_) {}
  }

  function removeDevtoolsOverlays() {
    try {
      var overlay = DOCUMENT.getElementById("ntk_devtools_overlay");
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    } catch (_) {}

    try {
      var dialogs = DOCUMENT.querySelectorAll("[role='dialog']");
      for (var i = 0; i < dialogs.length; i += 1) {
        var dialog = dialogs[i];
        var text = dialog.textContent || "";
        if (/개발자\s*도구|DevTools|devtools/i.test(text)) {
          if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        }
      }
    } catch (_) {}

    try { DOCUMENT.documentElement.style.userSelect = ""; } catch (_) {}
    try { if (DOCUMENT.body) DOCUMENT.body.style.overflow = ""; } catch (_) {}
  }

  function installOverlayCleaner() {
    function start() {
      removeDevtoolsOverlays();
      try {
          var Observer = WINDOW.MutationObserver || MutationObserver;
          var observer = new Observer(removeDevtoolsOverlays);
          observer.observe(DOCUMENT.documentElement, { childList: true, subtree: true });
      } catch (_) {}
    }

    if (DOCUMENT.documentElement) start();
    else {
      try { DOCUMENT.addEventListener("DOMContentLoaded", start, { once: true }); } catch (_) {}
    }
  }

  var nativeAddEventListener = EVENT_TARGET.prototype.addEventListener;
  var nativeRemoveEventListener = EVENT_TARGET.prototype.removeEventListener;

  installDisableDevtoolNoop();
  installPreflightBypass();
  installFormatterFilter();
  installEventShield(nativeAddEventListener);
  installEventRegistrationGuard(nativeAddEventListener, nativeRemoveEventListener);
  installViewportGapMask();
  installConsoleClearGuard();
  installOverlayCleaner();
  clearWarnState();
  try { WINDOW.setInterval(clearWarnState, 3000); } catch (_) {}
})();
