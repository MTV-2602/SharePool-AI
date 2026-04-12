// ============================================================
// popup.js – AutoFill Extension v5.1 FULL CLEAN
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  // Tab switching
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".nav-btn")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".tab-panel")
        .forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "pass") refreshPassDisplay();
    });
  });

  // Toast
  function showToast(msg, color = "#27ae60") {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.background = color;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2500);
  }

  // Copy to clipboard
  function copyText(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
  }

  // Luhn algorithm
  function luhnCheckDigit(partial) {
    let digits = partial.split("").map(Number).reverse();
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = digits[i];
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return (10 - (sum % 10)) % 10;
  }

  function generateNextCardFromBIN(bin, length = 16) {
    const binStr = String(bin).replace(/\D/g, "");
    const accountLen = length - binStr.length - 1;
    if (accountLen < 0) return null;
    let account = "";
    for (let j = 0; j < accountLen; j++)
      account += Math.floor(Math.random() * 10);
    const partial = binStr + account;
    const checkDigit = luhnCheckDigit(partial);
    const pan = partial + checkDigit;
    const mm = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
    const yyyy = (2027 + Math.floor(Math.random() * 8)).toString();
    const cvv = length === 15 ? "1234" : "123";
    return `${pan}|${mm}|${yyyy}|${cvv}`;
  }

  function parseAutoBINList(raw) {
    const source = Array.isArray(raw) ? raw.join("\n") : String(raw || "");
    const items = source
      .split(/\r?\n|,|;|\s+/)
      .map((s) => s.replace(/\D/g, "").trim())
      .filter((s) => s.length >= 1 && s.length <= 15);
    return [...new Set(items)];
  }

  function normalizeAutoTestScope(v) {
    return "per_bin";
  }

  function normalizeAutoBinStrategy(v) {
    return ["round_robin", "sequential", "random"].includes(v)
      ? v
      : "round_robin";
  }

  function normalizeAutoExpiryMode(v) {
    return ["random_future", "fixed", "next_year"].includes(v)
      ? v
      : "random_future";
  }

  function normalizeAutoCvvMode(v) {
    return ["fixed_test", "random"].includes(v) ? v : "fixed_test";
  }

  // Address Mode
  const ADDRESS_MODE_DEFAULT = "random_kr_indo_mix";
  const ADDRESS_MODE_PLACEHOLDERS = {
    random_kr_indo_mix:
      "John Vinh|South Korea|Seoul|Sidoarjo|Jl. Sudirman No. 52|61212",
    random_us_indo_mix:
      "John Carter|United States|California|Sidoarjo|Jl. Pahlawan No. 31|61212",
    random_uk_indo_mix:
      "Oliver Smith|United Kingdom|England|Sidoarjo|Jl. Sudirman No. 52|61212",
    random_kr: "김민서|Seoul|Seoul|43, Noksapyeong-daero 26-gil|04345",
    random_us: "John Carter|California|Los Angeles|845 S Figueroa St|90001",
    random_uk: "Oliver Smith|England|London|63 Lower White Road|B32 2RU",
    random_jp: "Taro Sato|Tokyo|Tokyo|1-1 Chiyoda|100-0001",
    random_indonesia: "Budi Santoso|Indonesia|Jawa Timur|Sidoarjo|Jl. Pahlawan No. 31|61212",
    random_india: "Arjun Mehta|Delhi|New Delhi|52 Connaught Place|110001",
    random_algeria:
      "Yacine Benali|Algiers Province|Algiers|12 Rue Didouche Mourad|16000",
    random_kazakhstan: "Aruzhan Bek|Almaty|Almaty|63 Abylai Khan Ave|050000",
    random_chile: "Matias Gonzalez|Santiago Metropolitan|Santiago|123 Avenida Libertador Bernardo O'Higgins|8320000",
    random_any: "Random Any (Global)",
    fixed_kr: "김민서|Seoul|Seoul|43, Noksapyeong-daero 26-gil|04345",
    fixed_us: "John Carter|California|Los Angeles|845 S Figueroa St|90001",
    fixed_uk: "Oliver Smith|England|London|63 Lower White Road|B32 2RU",
    fixed_jp: "Taro Sato|Tokyo|Tokyo|1-1 Chiyoda|100-0001",
    fixed_indonesia: "Budi Santoso|Indonesia|Jawa Timur|Sidoarjo|Jl. Pahlawan No. 31|61212",
    fixed_india: "Arjun Mehta|Delhi|New Delhi|52 Connaught Place|110001",
    fixed_algeria:
      "Yacine Benali|Algiers Province|Algiers|12 Rue Didouche Mourad|16000",
    fixed_kazakhstan: "Aruzhan Bek|Almaty|Almaty|63 Abylai Khan Ave|050000",
    fixed_chile: "Matias Gonzalez|Santiago Metropolitan|Santiago|123 Avenida Libertador Bernardo O'Higgins|8320000",
  };

  function normalizeAddressMode(mode) {
    return ADDRESS_MODE_PLACEHOLDERS.hasOwnProperty(mode)
      ? mode
      : ADDRESS_MODE_DEFAULT;
  }

  function updateAddressModeUI(mode) {
    const normalized = normalizeAddressMode(mode);
    const modeEl = document.getElementById("addr-mode");
    const inputEl = document.getElementById("addr-input");
    if (modeEl) modeEl.value = normalized;
    if (inputEl)
      inputEl.placeholder = ADDRESS_MODE_PLACEHOLDERS[normalized] || "";
  }

  const addrModeSelect = document.getElementById("addr-mode");
  if (addrModeSelect) {
    addrModeSelect.addEventListener("change", () => {
      const mode = normalizeAddressMode(addrModeSelect.value);
      updateAddressModeUI(mode);
      chrome.storage.local.set(
        {
          addressMode: mode,
          lockedAddrData: null,
          lockedAddrMode: "",
        },
        () => showToast(`✅ Đã chọn mode địa chỉ: ${mode}`, "#2980b9"),
      );
    });
  }

  // Load data
  chrome.storage.local.get(
    [
      "cards",
      "addresses",
      "passes",
      "cardIndex",
      "addrIndex",
      "passIndex",
      "addressMode",
      "isAutoGenMode",
      "autoBIN",
      "autoBINList",
      "autoBinIndex",
      "autoBinUsageMap",
      "cardLength",
      "maxTestCount",
      "testCounter",
      "autoTestScope",
      "autoBinStrategy",
      "autoExpiryMode",
      "autoCvvMode",
      "usedCardsLog",
      "successfulCardsLog",
    ],
    (data) => {
      if (data.cards)
        document.getElementById("card-input").value = Array.isArray(data.cards)
          ? data.cards.join("\n")
          : data.cards;
      if (data.addresses)
        document.getElementById("addr-input").value = data.addresses;
      if (data.passes)
        document.getElementById("pass-input").value = data.passes;
      if (data.usedCardsLog)
        document.getElementById("used-cards-log").value = data.usedCardsLog;
      if (data.successfulCardsLog)
        document.getElementById("success-cards-log").value =
          data.successfulCardsLog;

      updateAddressModeUI(data.addressMode);
      updateStatus(data);
      refreshPassDisplay(data);
    },
  );

  // Update Status
  function updateStatus(data) {
    const cards = (data.cards || "")
      .toString()
      .split("\n")
      .filter((l) => l.trim());
    const addrs = (data.addresses || "")
      .toString()
      .split("\n")
      .filter((l) => l.trim());
    const passes = (data.passes || "")
      .toString()
      .split("\n")
      .filter((l) => l.trim());

    const cardProgress = document.getElementById("card-progress");
    const addrProgress = document.getElementById("addr-progress");
    const passProgress = document.getElementById("pass-progress");
    if (cardProgress) cardProgress.textContent = `${data.cardIndex || 0} / ${cards.length}`;
    if (addrProgress) addrProgress.textContent = `${data.addrIndex || 0} / ${addrs.length}`;
    if (passProgress) passProgress.textContent = `${data.passIndex || 0} / ${passes.length}`;

    // Load Auto Gen inputs from storage
    const binInput = document.getElementById("auto-bin");
    const lengthInput = document.getElementById("auto-length");
    const countInput = document.getElementById("auto-count");
    const strategyInput = document.getElementById("auto-bin-strategy");
    const expiryInput = document.getElementById("auto-expiry-mode");
    const cvvInput = document.getElementById("auto-cvv-mode");
    const usedCardsLogEl = document.getElementById("used-cards-log");
    const successCardsLogEl = document.getElementById("success-cards-log");

    const binList = parseAutoBINList(data.autoBINList || data.autoBIN || "");
    if (binInput) {
      binInput.value = binList.join("\n");
    }
    if (lengthInput) {
      lengthInput.value = data.cardLength || 16;
    }
    if (countInput) {
      countInput.value = data.maxTestCount || 100;
    }
    if (strategyInput) {
      strategyInput.value = normalizeAutoBinStrategy(data.autoBinStrategy);
    }
    if (expiryInput) {
      expiryInput.value = normalizeAutoExpiryMode(data.autoExpiryMode);
    }
    if (cvvInput) {
      cvvInput.value = normalizeAutoCvvMode(data.autoCvvMode);
    }
    if (usedCardsLogEl) usedCardsLogEl.value = data.usedCardsLog || "";
    if (successCardsLogEl) successCardsLogEl.value = data.successfulCardsLog || "";

    const autoStatus = document.getElementById("auto-gen-status");
    if (autoStatus) {
      if (data.isAutoGenMode === true && binList.length) {
        const currentBin = binList[Number(data.autoBinIndex || 0) % binList.length] || binList[0];
        const scope = normalizeAutoTestScope(data.autoTestScope);
        const strategy = normalizeAutoBinStrategy(data.autoBinStrategy);
        const scopeLabel = scope === "per_bin" ? "Theo BIN" : "Tổng";
        autoStatus.innerHTML = `🔴 <strong>AUTO GEN BIN ĐANG BẬT</strong><br>BIN hiện tại: <strong>${currentBin}</strong> | Tổng BIN: <strong>${binList.length}</strong><br>Mode: <strong>${scopeLabel}</strong> | Strategy: <strong>${strategy}</strong><br>Test: ${data.testCounter || 0} | Max: ${data.maxTestCount || 100}`;
        autoStatus.style.color = "#e74c3c";
      } else {
        autoStatus.textContent = "📋 Đang dùng danh sách thẻ thủ công";
        autoStatus.style.color = "#2c3e50";
      }
    }

    // Render BIN status table
    renderBinStatusTable(binList, data.autoBinUsageMap || {}, data.isAutoGenMode);
  }

  // ── Render BIN Status Table ──
  function renderBinStatusTable(binList, usageMap, isActive) {
    const wrap = document.getElementById("bin-status-wrap");
    const listEl = document.getElementById("bin-status-list");
    if (!wrap || !listEl) return;

    if (!isActive || !binList.length) {
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "block";
    listEl.innerHTML = "";

    const testedBins = binList.filter(b => (usageMap[b] || 0) > 0);
    const untestedBins = binList.filter(b => (usageMap[b] || 0) === 0);
    const testedCount = testedBins.length;
    // Update header count
    const headerSpan = wrap.querySelector(".bin-status-header span");
    if (headerSpan) headerSpan.textContent = `📊 Trạng thái BIN (đã test: ${testedCount}/${binList.length})`;

    // Gán data cho nút copy
    const copyTestedBtn = document.getElementById("btn-copy-tested-bins");
    const copyUntestedBtn = document.getElementById("btn-copy-untested-bins");
    if (copyTestedBtn) {
      copyTestedBtn.onclick = () => {
        if (!testedBins.length) return showToast("⚠️ Không có BIN đã test!", "#e67e22");
        navigator.clipboard.writeText(testedBins.join("\n")).then(() =>
          showToast(`📋 Đã copy ${testedBins.length} BIN đã test!`, "#27ae60")
        );
      };
    }
    if (copyUntestedBtn) {
      copyUntestedBtn.onclick = () => {
        if (!untestedBins.length) return showToast("⚠️ Không có BIN chưa test!", "#e67e22");
        navigator.clipboard.writeText(untestedBins.join("\n")).then(() =>
          showToast(`📋 Đã copy ${untestedBins.length} BIN chưa test!`, "#2980b9")
        );
      };
    }

    binList.forEach(bin => {
      const count = usageMap[bin] || 0;
      const isTested = count > 0;
      const row = document.createElement("div");
      row.className = `bin-row ${isTested ? "tested" : "untested"}`;
      row.innerHTML = `
        <span class="bin-name">${bin}</span>
        <span class="bin-badge ${isTested ? "tested" : "untested"}">${isTested ? "✅ Đã test" : "⏳ Chưa"}</span>
        <span class="bin-count">${count > 0 ? count + " lần" : ""}</span>
        <button class="bin-del-btn" data-bin="${bin}">🗑️</button>
      `;
      listEl.appendChild(row);
    });

    // Xóa từng BIN
    listEl.querySelectorAll(".bin-del-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const bin = btn.dataset.bin;
        chrome.storage.local.get(["autoBINList", "autoBIN", "autoBinUsageMap"], d => {
          let list = parseAutoBINList(d.autoBINList || d.autoBIN || "");
          list = list.filter(b => b !== bin);
          const newMap = Object.assign({}, d.autoBinUsageMap || {});
          delete newMap[bin];
          chrome.storage.local.set({
            autoBINList: list,
            autoBIN: list[0] || "",
            autoBinUsageMap: newMap,
            autoBinIndex: 0
          }, () => {
            showToast(`🗑️ Đã xóa BIN ${bin}`, "#e74c3c");
            chrome.storage.local.get(null, updateStatus);
          });
        });
      });
    });
  }

  // Reset số lần test (giữ nguyên danh sách BIN)
  document.getElementById("btn-reset-bin-usage").addEventListener("click", () => {
    chrome.storage.local.set({ autoBinUsageMap: {}, testCounter: 0, autoBinIndex: 0 }, () => {
      showToast("🔄 Đã reset số lần test của tất cả BIN!", "#e67e22");
      chrome.storage.local.get(null, updateStatus);
    });
  });

  // Xóa hết BIN đã test khỏi danh sách
  document.getElementById("btn-clear-tested-bins").addEventListener("click", () => {
    chrome.storage.local.get(["autoBINList", "autoBIN", "autoBinUsageMap"], d => {
      const list = parseAutoBINList(d.autoBINList || d.autoBIN || "");
      const usageMap = d.autoBinUsageMap || {};
      const remaining = list.filter(b => (usageMap[b] || 0) === 0);
      const newMap = {};
      remaining.forEach(b => { if (usageMap[b]) newMap[b] = usageMap[b]; });
      chrome.storage.local.set({
        autoBINList: remaining,
        autoBIN: remaining[0] || "",
        autoBinUsageMap: newMap,
        autoBinIndex: 0
      }, () => {
        showToast(`🗑️ Đã xóa ${list.length - remaining.length} BIN đã test!`, "#e74c3c");
        const binInputEl = document.getElementById("auto-bin");
        if (binInputEl) binInputEl.value = remaining.join("\n");
        chrome.storage.local.get(null, updateStatus);
      });
    });
  });

  function refreshPassDisplay(data) {
    if (!data) {
      chrome.storage.local.get(["passes", "passIndex"], (d) =>
        refreshPassDisplay(d),
      );
      return;
    }
    const passes = (data.passes || "").split("\n").filter((l) => l.trim());
    const pi = data.passIndex || 0;
    const display = document.getElementById("pass-display");
    const valEl = document.getElementById("pass-current");
    const metaEl = document.getElementById("pass-idx-label");

    if (!display || !valEl || !metaEl) return;
    if (passes.length === 0) {
      display.style.display = "none";
      return;
    }
    display.style.display = "block";
    if (pi < passes.length) {
      valEl.textContent = passes[pi];
      metaEl.textContent = `${pi + 1} / ${passes.length}`;
    } else {
      valEl.textContent = "✅ Đã copy hết!";
      metaEl.textContent = `${passes.length} / ${passes.length}`;
    }
  }

  // Save Manual Cards
  document.getElementById("btn-save-cards").addEventListener("click", () => {
    const val = document.getElementById("card-input").value.trim();
    chrome.storage.local.set(
      { cards: val, cardIndex: 0, isAutoGenMode: false },
      () => {
        showToast("✅ Đã lưu danh sách thẻ thủ công!");
        chrome.storage.local.get(null, updateStatus);
      },
    );
  });

  // Enable Auto Gen BIN
  document
    .getElementById("btn-enable-auto-gen")
    .addEventListener("click", async () => {
      const bins = parseAutoBINList(document.getElementById("auto-bin").value);
      const length =
        parseInt(document.getElementById("auto-length").value) || 16;
      const maxTests =
        parseInt(document.getElementById("auto-count").value) || 100;
      const testScope = "per_bin";
      const binStrategy = normalizeAutoBinStrategy(
        document.getElementById("auto-bin-strategy").value,
      );
      const expiryMode = normalizeAutoExpiryMode(
        document.getElementById("auto-expiry-mode").value,
      );
      const cvvMode = normalizeAutoCvvMode(
        document.getElementById("auto-cvv-mode").value,
      );

      if (!bins.length)
        return showToast("Vui lòng nhập ít nhất 1 BIN hợp lệ!", "#e74c3c");

      document.getElementById("auto-bin").value = bins.join("\n");

      await chrome.storage.local.set({
        isAutoGenMode: true,
        autoBIN: bins[0],
        autoBINList: bins,
        autoBinIndex: 0,
        cardLength: length,
        maxTestCount: maxTests,
        testCounter: 0,
        cardIndex: 0,
        autoTestScope: testScope,
        autoBinStrategy: binStrategy,
        autoExpiryMode: expiryMode,
        autoCvvMode: cvvMode,
        autoBinUsageMap: {},
      });

      showToast(
        `🚀 AUTO GEN BIN ĐÃ BẬT!\nBIN: ${bins.length} dòng | Mode: ${testScope} | Max: ${maxTests}`,
        "#27ae60",
      );
      chrome.storage.local.get(null, updateStatus);
    });

  // Disable Auto Gen BIN
  document
    .getElementById("btn-disable-auto-gen")
    .addEventListener("click", () => {
      chrome.storage.local.set({ isAutoGenMode: false }, () => {
        showToast("⛔ Đã tắt Auto Gen BIN", "#95a5a6");
        chrome.storage.local.get(null, updateStatus);
      });
    });

  document
    .getElementById("btn-clear-used-cards")
    .addEventListener("click", () => {
      chrome.storage.local.set({ usedCardsLog: "" }, () => {
        showToast("🧹 Đã xóa danh sách thẻ đã dùng", "#95a5a6");
        chrome.storage.local.get(null, updateStatus);
      });
    });

  document
    .getElementById("btn-clear-success-cards")
    .addEventListener("click", () => {
      chrome.storage.local.set({ successfulCardsLog: "" }, () => {
        showToast("🧹 Đã xóa danh sách thẻ thành công", "#95a5a6");
        chrome.storage.local.get(null, updateStatus);
      });
    });

  // Save Address
  document.getElementById("btn-save-addr").addEventListener("click", () => {
    const val = document.getElementById("addr-input").value.trim();
    const mode = normalizeAddressMode(
      document.getElementById("addr-mode").value,
    );
    chrome.storage.local.set(
      {
        addresses: val,
        addrIndex: 0,
        addressMode: mode,
        lockedAddrData: null,
        lockedAddrMode: "",
      },
      () => {
        showToast("✅ Đã lưu danh sách địa chỉ!");
        chrome.storage.local.get(null, updateStatus);
      },
    );
  });

  // Save Pass
  document.getElementById("btn-save-pass").addEventListener("click", () => {
    const val = document.getElementById("pass-input").value.trim();
    chrome.storage.local.set({ passes: val, passIndex: 0 }, () => {
      showToast("✅ Đã lưu danh sách pass!", "#8e44ad");
      chrome.storage.local.get(["passes", "passIndex"], refreshPassDisplay);
    });
  });

  // Copy next pass
  document
    .getElementById("btn-copy-next-pass")
    .addEventListener("click", () => {
      chrome.storage.local.get(["passes", "passIndex"], (data) => {
        const passes = (data.passes || "").split("\n").filter((l) => l.trim());
        const pi = data.passIndex || 0;
        if (pi >= passes.length) return showToast("⚠️ Đã hết pass!", "#e67e22");
        copyText(passes[pi]).then(() => {
          chrome.storage.local.set({ passIndex: pi + 1 }, () => {
            showToast(`📋 Đã copy: ${passes[pi]}`, "#8e44ad");
            refreshPassDisplay();
          });
        });
      });
    });

  // Reset buttons
  document.getElementById("btn-reset-card").addEventListener("click", () => {
    chrome.storage.local.set({ cardIndex: 0 }, () => {
      showToast("🔄 Reset thẻ!");
      chrome.storage.local.get(null, updateStatus);
    });
  });

  document.getElementById("btn-reset-addr").addEventListener("click", () => {
    chrome.storage.local.set(
      { addrIndex: 0, lockedAddrData: null, lockedAddrMode: "" },
      () => {
        showToast("🔄 Reset địa chỉ!");
        chrome.storage.local.get(null, updateStatus);
      },
    );
  });

  document.getElementById("btn-reset-pass").addEventListener("click", () => {
    chrome.storage.local.set({ passIndex: 0 }, () => {
      showToast("🔄 Reset pass!", "#8e44ad");
      refreshPassDisplay();
    });
  });

  // Email Converter
  let emailResultLines = [];
  document.getElementById("btn-convert-email").addEventListener("click", () => {
    const raw = document.getElementById("email-input").value.trim();
    if (!raw) return showToast("⚠️ Vui lòng nhập email!", "#e67e22");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("@"));
    if (!lines.length)
      return showToast("⚠️ Không tìm thấy email hợp lệ!", "#e67e22");

    emailResultLines = lines.map((email) => {
      const lastDot = email.lastIndexOf(".");
      const emailNoTld = lastDot >= 0 ? email.substring(0, lastDot) : email;
      const genUrl = `https://generator.email/${email}`;
      return `${email}----${emailNoTld}----${genUrl}`;
    });

    const listEl = document.getElementById("email-result-list");
    listEl.innerHTML = "";
    emailResultLines.forEach((line, i) => {
      const item = document.createElement("div");
      item.className = "result-item";
      item.innerHTML = `<span class="result-text">${line}</span><button class="btn-copy-one" data-idx="${i}">📋</button>`;
      listEl.appendChild(item);
    });

    listEl.querySelectorAll(".btn-copy-one").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx);
        copyText(emailResultLines[idx]).then(() => {
          btn.textContent = "✅";
          setTimeout(() => (btn.textContent = "📋"), 1500);
          showToast("📋 Đã copy dòng " + (idx + 1));
        });
      });
    });

    document.getElementById("email-count").textContent = lines.length;
    document.getElementById("email-result-wrap").style.display = "block";
    showToast(`✅ Chuyển xong ${lines.length} email!`);
  });

  document
    .getElementById("btn-copy-all-email")
    .addEventListener("click", () => {
      if (!emailResultLines.length) return;
      copyText(emailResultLines.join("\n")).then(() =>
        showToast("📋 Đã copy tất cả!"),
      );
    });

  function parseHotmailCredentialLine(rawLine) {
    const line = String(rawLine || "").trim();
    if (!line) return null;
    const parts = line.split("|").map((p) => String(p || "").trim());
    if (parts.length < 4) return null;
    return {
      email: parts[0],
      password: parts[1],
      refreshToken: parts[2],
      clientId: parts[3],
    };
  }

  async function testHotmailInboxViaProxy(proxyUrl, rawLine) {
    const endpoint = String(proxyUrl || "").trim();
    if (!endpoint) {
      throw new Error("Thiếu proxy URL");
    }

    const isFullLine = rawLine.includes("|");
    const payload = isFullLine
      ? { line: rawLine, top: 3 }
      : { email: rawLine, top: 3 };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json?.ok) {
      const detail = json?.error || `Proxy error HTTP ${resp.status}`;
      throw new Error(detail);
    }

    return {
      messages: Array.isArray(json.messages) ? json.messages : [],
      rotatedRefreshToken: json.rotatedRefreshToken || "",
      grantedScope: json.scope || "",
      email: json.email || "",
    };
  }

  function hotmailEndpointFromRead(proxyUrl, path) {
    return String(proxyUrl || "").replace(/\/read-hotmail\/?$/i, path);
  }

  function splitNonEmptyLines(raw) {
    return String(raw || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function loadHotmailAccountsToSelect(proxyUrl) {
    const selectEl = document.getElementById("hotmail-account-select");
    if (!selectEl) return;

    let accountsUrl;
    if (proxyUrl.includes("/api/hotmail")) {
      accountsUrl = String(proxyUrl).replace(/\/read\/?$/i, "/accounts");
    } else {
      accountsUrl = hotmailEndpointFromRead(proxyUrl, "/accounts");
    }
    const resp = await fetch(accountsUrl);
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json?.ok) {
      throw new Error(json?.error || `Load accounts error HTTP ${resp.status}`);
    }

    const accounts = Array.isArray(json.accounts) ? json.accounts : [];
    selectEl.innerHTML = '<option value="">-- Chon account da luu --</option>';
    accounts.forEach((acc) => {
      const opt = document.createElement("option");
      opt.value = acc.email || "";
      opt.textContent = acc.email || "";
      selectEl.appendChild(opt);
    });
  }

  chrome.storage.local.get(["hotmailProxyUrl"], (data) => {
    const proxyEl = document.getElementById("hotmail-proxy-url");
    if (!proxyEl) return;
    if (data.hotmailProxyUrl) proxyEl.value = data.hotmailProxyUrl;

    const currentProxy = proxyEl.value.trim();
    if (currentProxy) {
      loadHotmailAccountsToSelect(currentProxy).catch(() => {});
    }
  });

  document.getElementById("btn-load-hotmail-accounts")?.addEventListener("click", async () => {
    const proxyEl = document.getElementById("hotmail-proxy-url");
    if (!proxyEl) return;
    const proxyUrl = proxyEl.value.trim();
    if (!proxyUrl) return showToast("⚠️ Vui long nhap Proxy URL", "#e67e22");

    try {
      await loadHotmailAccountsToSelect(proxyUrl);
      showToast("✅ Da tai danh sach accounts", "#27ae60");
    } catch (err) {
      showToast(`❌ ${err.message || String(err)}`, "#e74c3c");
    }
  });

  document.getElementById("btn-use-hotmail-account")?.addEventListener("click", () => {
    const selectEl = document.getElementById("hotmail-account-select");
    const inputEl = document.getElementById("hotmail-cred-input");
    if (!selectEl || !inputEl) return;
    if (!selectEl.value) return showToast("⚠️ Chua chon account", "#e67e22");
    inputEl.value = selectEl.value;
    showToast("📌 Da dien email vao o input", "#2980b9");
  });

  document.getElementById("btn-delete-hotmail-account")?.addEventListener("click", async () => {
    const selectEl = document.getElementById("hotmail-account-select");
    const proxyEl = document.getElementById("hotmail-proxy-url");
    const resultEl = document.getElementById("hotmail-test-result");
    if (!selectEl || !proxyEl || !resultEl) return;

    const email = String(selectEl.value || "").trim();
    if (!email) return showToast("⚠️ Chua chon account de xoa", "#e67e22");

    const proxyUrl = String(proxyEl.value || "").trim();
    if (!proxyUrl) return showToast("⚠️ Vui long nhap Proxy URL", "#e67e22");

    try {
      const isNew = proxyUrl.includes("/api/hotmail");
      let resp;
      if (isNew) {
        resp = await fetch(proxyUrl.replace(/\/read\/?$/i, "") + "/delete/" + encodeURIComponent(email), {
          method: "DELETE"
        });
      } else {
        const deleteUrl = hotmailEndpointFromRead(proxyUrl, "/delete-hotmail-account");
        resp = await fetch(deleteUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
      }
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error || `Delete error HTTP ${resp.status}`);
      }

      resultEl.value = `OK: Da xoa account ${email}`;
      await loadHotmailAccountsToSelect(proxyUrl);
      showToast("✅ Da xoa account", "#27ae60");
    } catch (err) {
      resultEl.value = `Loi xoa account: ${err?.message || String(err)}`;
      showToast("❌ Xoa account that bai", "#e74c3c");
    }
  });

  document.getElementById("btn-save-hotmail-account")?.addEventListener("click", async () => {
    const inputEl = document.getElementById("hotmail-cred-input");
    const proxyEl = document.getElementById("hotmail-proxy-url");
    const resultEl = document.getElementById("hotmail-test-result");
    const btn = document.getElementById("btn-save-hotmail-account");
    if (!inputEl || !proxyEl || !resultEl || !btn) return;

    const lines = splitNonEmptyLines(inputEl.value);
    const fullLines = lines.filter((l) => parseHotmailCredentialLine(l));
    if (!fullLines.length) {
      showToast("⚠️ Can it nhat 1 line day du de luu account", "#e67e22");
      return;
    }

    const proxyUrl = proxyEl.value.trim();
    if (!proxyUrl) {
      showToast("⚠️ Vui long nhap Proxy URL", "#e67e22");
      return;
    }

    let saveUrl;
    if (proxyUrl.includes("/api/hotmail")) {
      saveUrl = proxyUrl.replace(/\/read\/?$/i, "/save");
    } else {
      saveUrl = proxyUrl.replace(/\/read-hotmail\/?$/i, "/save-hotmail-account");
    }
    
    chrome.storage.local.set({ hotmailProxyUrl: proxyUrl });
    btn.disabled = true;
    resultEl.value = "Dang luu account vao proxy...";

    try {
      let okCount = 0;
      let failCount = 0;
      const errs = [];
      for (let i = 0; i < fullLines.length; i++) {
        const one = fullLines[i];
        const resp = await fetch(saveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ line: one }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json?.ok) {
          failCount += 1;
          errs.push(`[${i + 1}] ${json?.error || `HTTP ${resp.status}`}`);
        } else {
          okCount += 1;
        }
      }

      resultEl.value = [
        `OK: Da luu ${okCount}/${fullLines.length} account`,
        ...(errs.length ? ["", "Loi:", ...errs] : []),
      ].join("\n");
      loadHotmailAccountsToSelect(proxyUrl).catch(() => {});
      showToast("✅ Da luu account", "#27ae60");
    } catch (err) {
      resultEl.value = `Loi luu account: ${err?.message || String(err)}`;
      showToast("❌ Luu account that bai", "#e74c3c");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-test-hotmail")?.addEventListener("click", async () => {
    const inputEl = document.getElementById("hotmail-cred-input");
    const proxyEl = document.getElementById("hotmail-proxy-url");
    const resultEl = document.getElementById("hotmail-test-result");
    const btn = document.getElementById("btn-test-hotmail");
    if (!inputEl || !proxyEl || !resultEl || !btn) return;

    const rawLine = inputEl.value.trim();
    const isFullLine = rawLine.includes("|");
    const cred = isFullLine ? parseHotmailCredentialLine(rawLine) : null;
    if (!rawLine) {
      showToast("⚠️ Nhap email hoac line day du", "#e67e22");
      return;
    }
    if (isFullLine && !cred) {
      showToast("⚠️ Sai dinh dang line day du", "#e67e22");
      return;
    }

    const proxyUrl = proxyEl.value.trim();
    if (!proxyUrl) {
      showToast("⚠️ Vui lòng nhập Proxy URL", "#e67e22");
      return;
    }

    chrome.storage.local.set({ hotmailProxyUrl: proxyUrl });

    btn.disabled = true;
    resultEl.value = "Đang gọi proxy để đọc inbox...";

    try {
      const lines = splitNonEmptyLines(rawLine);
      const outputs = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const r = await testHotmailInboxViaProxy(proxyUrl, line);
        const rows = r.messages.map((m, idx) => {
          const subject = String(m?.subject || m?.Subject || "(No subject)").replace(/\s+/g, " ").trim();
          const date = m?.receivedDateTime || m?.ReceivedDateTime || "";
          const from = m?.from || m?.From?.EmailAddress?.Address || "(unknown)";
          return `${idx + 1}. ${date} | ${from} | ${subject}`;
        });
        outputs.push(
          [
            `[${i + 1}/${lines.length}] ${r.email || line}`,
            `Scope: ${r.grantedScope || "(unknown)"}`,
            ...(rows.length ? rows : ["Inbox trống"]),
            "",
          ].join("\n"),
        );
      }

      resultEl.value = outputs.join("\n");
      showToast("✅ Test inbox thành công", "#27ae60");
    } catch (err) {
      const msg = String(err?.message || err || "Unknown error");
      if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)) {
        resultEl.value = [
          "Lỗi: Không kết nối được Proxy.",
          "",
          "Cách xử lý:",
          "1) Chạy server: node hotmail-proxy-server.mjs",
          "2) Mở đúng URL proxy (mặc định: http://localhost:8787/read-hotmail)",
          "3) Nếu đổi cổng thì sửa lại ô Proxy URL trong popup",
          "",
          `Chi tiết: ${msg}`,
        ].join("\n");
      } else {
        resultEl.value = `Lỗi: ${msg}`;
      }
      showToast("❌ Test thất bại", "#e74c3c");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-hotmail-read-code")?.addEventListener("click", async () => {
    const inputEl = document.getElementById("hotmail-cred-input");
    const proxyEl = document.getElementById("hotmail-proxy-url");
    const resultEl = document.getElementById("hotmail-test-result");
    const btn = document.getElementById("btn-hotmail-read-code");
    if (!inputEl || !proxyEl || !resultEl || !btn) return;

    const rawLine = inputEl.value.trim();
    if (!rawLine) return showToast("⚠️ Nhap email hoac line", "#e67e22");

    const proxyUrl = proxyEl.value.trim();
    if (!proxyUrl) return showToast("⚠️ Vui long nhap Proxy URL", "#e67e22");

    btn.disabled = true;
    resultEl.value = "Dang lay OTP code...";
    try {
      const lines = splitNonEmptyLines(rawLine);
      const outputs = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const r = await testHotmailInboxViaProxy(proxyUrl, line);
        const latest = Array.isArray(r.messages) && r.messages.length ? r.messages[0] : null;
        const source = `${latest?.subject || ""}\n${latest?.bodyPreview || ""}`;
        const code = extractOtpCode(source);
        if (code) {
          outputs.push(`[${i + 1}/${lines.length}] ${r.email || line} -> OTP: ${code}`);
        } else {
          outputs.push(`[${i + 1}/${lines.length}] ${r.email || line} -> Khong tim thay OTP`);
        }
      }

      resultEl.value = outputs.join("\n");
      const firstCode = outputs.map((o) => {
        const m = o.match(/OTP: (\d{4,8})/);
        return m ? m[1] : "";
      }).find(Boolean);
      if (firstCode) {
        copyText(firstCode);
        showToast(`✅ Da copy OTP: ${firstCode}`, "#27ae60");
      } else {
        showToast("⚠️ Khong tim thay OTP", "#e67e22");
      }
    } catch (err) {
      resultEl.value = `Loi lay OTP: ${err.message || String(err)}`;
      showToast("❌ Lay OTP that bai", "#e74c3c");
    } finally {
      btn.disabled = false;
    }
  });

  // ============================================================
  // TempMail Tab Handlers
  // ============================================================

  const tempMailEnabledCheckbox = document.getElementById("tempmail-enabled");
  const tempMailStatusBox = document.getElementById("tempmail-status-box");
  const tempMailCurrentEl = document.getElementById("tempmail-current");
  const tempMailTimeEl = document.getElementById("tempmail-generated-time");
  const btnGenTempMail = document.getElementById("btn-gen-tempmail");
  const btnCheckInbox = document.getElementById("btn-check-inbox");
  const btnGetLatestCode = document.getElementById("btn-get-latest-code");
  const btnCopyTempMail = document.getElementById("btn-copy-tempmail");
  const tempMailInboxDiv = document.getElementById("tempmail-inbox");
  const tempMailInboxList = document.getElementById("tempmail-inbox-list");
  const tempMailCodeBox = document.getElementById("tempmail-code-box");
  const tempMailLatestCodeEl = document.getElementById("tempmail-latest-code");
  const tempMailLoadingDiv = document.getElementById("tempmail-loading");
  const tempMailErrorDiv = document.getElementById("tempmail-error");

  function renderTempMailStatus(payload) {
    if (!payload?.email) return;
    tempMailCurrentEl.textContent = payload.email;
    const ts = Number(payload.timestamp || Date.now());
    tempMailTimeEl.textContent = `Tạo lúc: ${new Date(ts).toLocaleString("vi-VN")}`;
    tempMailStatusBox.style.display = "block";
    btnCopyTempMail.style.display = "block";
  }

  async function sendTempMailAction(action, extra = {}) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Không tìm thấy tab đang mở");
    return chrome.tabs.sendMessage(tab.id, { action, ...extra });
  }

  function extractOtpCode(raw) {
    const text = String(raw || "");
    const decoded = text
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 0))
      .replace(/&#x([\da-f]+);/gi, (_, h) =>
        String.fromCharCode(Number.parseInt(h, 16) || 0),
      )
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "");

    const normalized = decoded
      .replace(/(\d)[\s\-.](?=\d)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();

    const nearKeyword = normalized.match(
      /(?:verification|verify|security|one[-\s]?time|otp|login|code)[^\d]{0,50}(\d{4,8})/i,
    );
    if (nearKeyword && nearKeyword[1]) return nearKeyword[1];

    const m6 = normalized.match(/\b\d{6}\b/);
    if (m6) return m6[0];
    const mAny = normalized.match(/\b\d{4,8}\b/);
    return mAny ? mAny[0] : "";
  }

  // Load TempMail enabled status
  chrome.storage.local.get(["useTempMail", "lastTempMailAddress"], (data) => {
    tempMailEnabledCheckbox.checked = data.useTempMail === true;
    if (data.lastTempMailAddress) {
      renderTempMailStatus(data.lastTempMailAddress);
    }
  });

  // Toggle TempMail enabled
  tempMailEnabledCheckbox.addEventListener("change", () => {
    chrome.storage.local.set({ useTempMail: tempMailEnabledCheckbox.checked });
    showToast(
      tempMailEnabledCheckbox.checked
        ? "✅ TempMail kích hoạt"
        : "⚠️ TempMail tắt",
      tempMailEnabledCheckbox.checked ? "#27ae60" : "#e67e22"
    );
  });

  // Generate TempMail
  btnGenTempMail.addEventListener("click", async () => {
    if (tempMailCurrentEl.textContent.trim()) {
      const ok = confirm(
        "Bạn đang có email active. Tạo mới sẽ đổi email hiện tại. Tiếp tục?",
      );
      if (!ok) return;
    }

    btnGenTempMail.disabled = true;
    tempMailErrorDiv.style.display = "none";
    showToast("⏳ Đang sinh email...", "#3498db");

    try {
      const result = await sendTempMailAction("generateTempMail");

      if (result.success && result.email) {
        renderTempMailStatus(result.email);
        tempMailCodeBox.style.display = "none";
        showToast(`✅ Email: ${result.email.email}`, "#27ae60");
      } else {
        throw new Error(result.error || "Lỗi sinh email");
      }
    } catch (error) {
      tempMailErrorDiv.textContent = `❌ Lỗi: ${error.message}`;
      tempMailErrorDiv.style.display = "block";
      showToast("❌ Lỗi sinh email", "#e74c3c");
    } finally {
      btnGenTempMail.disabled = false;
    }
  });

  // Copy TempMail Email
  btnCopyTempMail.addEventListener("click", () => {
    const email = tempMailCurrentEl.textContent;
    if (email) {
      copyText(email).then(() => {
        btnCopyTempMail.textContent = "✅ Đã copy!";
        setTimeout(() => (btnCopyTempMail.textContent = "📋 Copy Email"), 1500);
        showToast("📋 Đã copy email", "#27ae60");
      });
    }
  });

  // Check Inbox
  btnCheckInbox.addEventListener("click", async () => {
    const emailText = tempMailCurrentEl.textContent;
    if (!emailText) {
      showToast("⚠️ Chưa có email! Sinh email trước.", "#e67e22");
      return;
    }

    btnCheckInbox.disabled = true;
    tempMailLoadingDiv.style.display = "block";
    tempMailErrorDiv.style.display = "none";
    tempMailInboxDiv.style.display = "block";
    tempMailInboxList.innerHTML = "";

    try {
      const result = await sendTempMailAction("getTempMailInbox", {
        email: emailText,
        limit: 20,
      });
      if (!result?.success) {
        throw new Error(result?.error || "Inbox error");
      }

      const emails = result.inbox?.emails || [];
      const [username, domain] = emailText.split("@");

      if (emails.length === 0) {
        tempMailInboxList.innerHTML =
          '<div style="color: #7f8c8d; text-align: center; padding: 20px">📭 Inbox trống</div>';
      } else {
        tempMailInboxList.innerHTML = emails
          .map((email) => {
            const subject = email.subject || "(No subject)";
            const sender = email.sender || "Unknown";
            const date = new Date(email.date).toLocaleString("vi-VN");
            return `
              <div style="border-bottom: 1px solid #ecf0f1; padding: 8px 0">
                <strong style="font-size: 13px">${subject}</strong><br>
                <small style="color: #7f8c8d">Từ: ${sender}</small><br>
                <small style="color: #95a5a6">${date}</small><br>
                <button class="btn-read-email" data-id="${email.id}" data-domain="${domain}" data-user="${username}"
                  style="margin-top: 4px; padding: 4px 8px; font-size: 11px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer">
                  📖 Đọc
                </button>
                <button class="btn-copy-code" data-id="${email.id}" data-domain="${domain}" data-user="${username}" data-subject="${encodeURIComponent(subject || "")}" data-body="${encodeURIComponent(String(email.body || ""))}" data-html="${encodeURIComponent(String(email.html_body || ""))}"
                  style="margin-top: 4px; margin-left: 6px; padding: 4px 8px; font-size: 11px; background: #e67e22; color: white; border: none; border-radius: 4px; cursor: pointer">
                  🔐 Copy code
                </button>
              </div>
            `;
          })
          .join("");

        // Add listeners to read buttons
        tempMailInboxList.querySelectorAll(".btn-read-email").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const emailId = btn.dataset.id;
            const emailDomain = btn.dataset.domain;
            const emailUsername = btn.dataset.user;

            try {
              const resp = await fetch(
                `https://tinyhost.shop/api/email/${emailDomain}/${emailUsername}/${emailId}`
              );
              if (!resp.ok) throw new Error(`API error: ${resp.status}`);
              const emailContent = await resp.json();
              alert(
                `Subject: ${emailContent.subject}\n\nFrom: ${emailContent.sender}\n\nContent:\n${emailContent.body}`
              );
            } catch (err) {
              alert(`❌ Lỗi: ${err.message}`);
            }
          });
        });

        tempMailInboxList.querySelectorAll(".btn-copy-code").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const decodedSubject = decodeURIComponent(btn.dataset.subject || "");
            const decodedBody = decodeURIComponent(btn.dataset.body || "");
            const decodedHtml = decodeURIComponent(btn.dataset.html || "");
            const code = extractOtpCode(
              `${decodedSubject}\n${decodedBody}\n${decodedHtml}`,
            );

            let finalCode = code;
            if (!finalCode) {
              try {
                const emailId = btn.dataset.id;
                const emailDomain = btn.dataset.domain;
                const emailUsername = btn.dataset.user;
                if (emailId && emailDomain && emailUsername) {
                  const resp = await fetch(
                    `https://tinyhost.shop/api/email/${emailDomain}/${emailUsername}/${emailId}`
                  );
                  if (resp.ok) {
                    const detail = await resp.json();
                    finalCode = extractOtpCode(
                      `${detail?.subject || ""}\n${detail?.body || ""}\n${detail?.html_body || ""}`,
                    );
                  }
                }
              } catch (_) {}
            }

            if (!finalCode) {
              showToast("Không tìm thấy OTP trong email này", "#e67e22");
              return;
            }

            copyText(finalCode).then(() => {
              tempMailLatestCodeEl.textContent = finalCode;
              tempMailCodeBox.style.display = "block";
              showToast(`Đã copy code: ${finalCode}`, "#27ae60");
            });
          });
        });
      }
    } catch (error) {
      tempMailErrorDiv.textContent = `❌ Lỗi: ${error.message}`;
      tempMailErrorDiv.style.display = "block";
    } finally {
      tempMailLoadingDiv.style.display = "none";
      btnCheckInbox.disabled = false;
    }
  });

  btnGetLatestCode.addEventListener("click", async () => {
    const emailText = tempMailCurrentEl.textContent.trim();
    if (!emailText) {
      showToast("⚠️ Chưa có email active", "#e67e22");
      return;
    }

    btnGetLatestCode.disabled = true;
    tempMailErrorDiv.style.display = "none";

    try {
      const result = await sendTempMailAction("getTempMailLatestCode", {
        email: emailText,
      });
      if (!result?.success) {
        throw new Error(result?.error || "Không lấy được code");
      }
      if (!result.code) {
        throw new Error("Chưa thấy OTP trong inbox mới nhất");
      }

      await copyText(result.code);
      tempMailLatestCodeEl.textContent = result.code;
      tempMailCodeBox.style.display = "block";
      showToast(`✅ Đã copy code: ${result.code}`, "#27ae60");
    } catch (error) {
      tempMailErrorDiv.textContent = `❌ Lỗi: ${error.message}`;
      tempMailErrorDiv.style.display = "block";
    } finally {
      btnGetLatestCode.disabled = false;
    }
  });
});

