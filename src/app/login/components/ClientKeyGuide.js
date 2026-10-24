"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, Button } from "@/shared/components";
import {
  describePolicy,
  selectDefaultModel,
  generateCodeSnippets,
  generateFullMarkdown,
  sanitizeModelId,
  sanitizeApiKey,
  sanitizeOrigin,
} from "./clientKeyGuideContent.js";

export function ClientKeyGuideInner({
  apiKey,
  keyData,
  apiOrigin = "http://localhost:20127",
  onDismiss,
}) {
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [guideSection, setGuideSection] = useState("ide");
  const [copiedField, setCopiedField] = useState("");
  const [copyError, setCopyError] = useState(null);

  const policy = keyData?.model_policy || null;
  const policyDesc = useMemo(() => describePolicy(policy), [policy]);

  // Fetch permitted catalog with bearer key only if key is present and policy is not blocked
  useEffect(() => {
    if (!apiKey || policyDesc.isBlocked) {
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;

    const fetchCatalog = async () => {
      setLoadingModels(true);
      setModels([]);
      setSelectedModel("");
      setCatalogError(null);
      setCopiedField("");
      setCopyError(null);

      let safeOrigin;
      let safeKey;
      try {
        safeOrigin = sanitizeOrigin(apiOrigin);
        safeKey = sanitizeApiKey(apiKey);
      } catch {
        setCatalogError("Địa chỉ máy chủ hoặc khóa không hợp lệ để tải danh mục mô hình.");
        setLoadingModels(false);
        return;
      }

      try {
        const res = await fetch(`${safeOrigin}/api/v1/models`, {
          headers: {
            Authorization: `Bearer ${safeKey}`,
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Máy chủ phản hồi mã lỗi ${res.status}`);
        }

        const data = await res.json();
        if (isCancelled) return;

        let list;
        if (Array.isArray(data)) {
          list = data;
        } else if (Array.isArray(data?.data)) {
          list = data.data;
        } else {
          throw new Error("Phản hồi danh mục mô hình không đúng định dạng danh sách");
        }

        const modelIds = list
          .map((m) => (typeof m === "string" ? m : m?.id || m?.name || ""))
          .map(sanitizeModelId)
          .filter(Boolean);

        if (modelIds.length === 0) {
          throw new Error("Không có mô hình nào khả dụng trong danh mục được cấp phép");
        }

        setModels(modelIds);
        const def = selectDefaultModel(modelIds);
        setSelectedModel(def || "");
        setLoadingModels(false);
      } catch (err) {
        if (!isCancelled && err.name !== "AbortError") {
          setCatalogError(err.message || "Không thể tải danh mục mô hình.");
          setModels([]);
          setSelectedModel("");
          setLoadingModels(false);
        }
      }
    };

    fetchCatalog();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [apiKey, apiOrigin, policyDesc.isBlocked]);

  const copyText = useCallback(async (text, fieldName) => {
    setCopyError(null);
    if (!navigator?.clipboard?.writeText) {
      setCopyError("Trình duyệt không hỗ trợ sao chép vào bộ nhớ tạm");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(""), 2000);
    } catch (err) {
      setCopyError("Không thể sao chép vào bộ nhớ tạm: " + (err.message || "Từ chối quyền truy cập"));
    }
  }, []);

  const selectedProvider = useMemo(() => {
    if (selectedModel && selectedModel.includes("/")) {
      return selectedModel.split("/")[0];
    }
    return null;
  }, [selectedModel]);

  const isSelectionValid =
    !loadingModels &&
    !catalogError &&
    !policyDesc.isBlocked &&
    Boolean(selectedModel) &&
    models.includes(selectedModel);

  const { snippets, snippetError } = useMemo(() => {
    if (!isSelectionValid) return { snippets: null, snippetError: null };
    try {
      const generated = generateCodeSnippets({
        selectedModel,
        provider: selectedProvider,
        apiOrigin,
        apiKey,
      });
      return { snippets: generated, snippetError: null };
    } catch {
      return {
        snippets: null,
        snippetError: "Cấu hình khóa hoặc địa chỉ máy chủ không hợp lệ để tạo mã tích hợp.",
      };
    }
  }, [isSelectionValid, selectedModel, selectedProvider, apiOrigin, apiKey]);

  const handleCopyMarkdown = async () => {
    if (!isSelectionValid) return;
    try {
      const md = generateFullMarkdown({
        selectedModel,
        provider: selectedProvider,
        apiOrigin,
        apiKey,
        keyLabel: keyData?.label,
        policy,
        models,
      });
      await copyText(md, "fullMarkdown");
    } catch {
      setCopyError("Lỗi cấu hình hoặc thông số không hợp lệ để tạo Markdown.");
    }
  };

  const handleDownloadMarkdown = () => {
    if (!isSelectionValid) return;
    try {
      const md = generateFullMarkdown({
        selectedModel,
        provider: selectedProvider,
        apiOrigin,
        apiKey,
        keyLabel: keyData?.label,
        policy,
        models,
        forDownload: true,
      });

      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ainoname-guide-${selectedModel.replace(/\//g, "-")}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setCopyError("Lỗi cấu hình hoặc thông số không hợp lệ để tải file Markdown.");
    }
  };

  const safeQuickBaseUrl = useMemo(() => {
    if (snippets?.baseUrl) return snippets.baseUrl;
    try {
      const validOrigin = sanitizeOrigin(apiOrigin);
      return `${validOrigin}/v1`;
    } catch {
      return "";
    }
  }, [snippets, apiOrigin]);

  const maskedApiKey = useMemo(() => {
    if (!apiKey || typeof apiKey !== "string") return "—";
    if (apiKey.length <= 14) {
      return apiKey.length <= 6 ? "••••••" : `${apiKey.slice(0, 3)}...${apiKey.slice(-3)}`;
    }
    return `${apiKey.slice(0, 8)}...${apiKey.slice(-6)}`;
  }, [apiKey]);

  if (policyDesc.isBlocked || catalogError || (!loadingModels && models.length === 0)) {
    return (
      <Card title="Hướng dẫn kết nối máy khách" icon="menu_book">
        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 text-sm space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <span className="material-symbols-outlined text-[20px]">block</span>
            <span>Không thể tạo hướng dẫn kết nối</span>
          </div>
          <p>
            {catalogError
              ? `Lỗi tải danh mục mô hình: ${catalogError}`
              : policyDesc.details[0] || "Không có mô hình nào khả dụng cho khóa này."}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Policy & Restrictions Banner */}
      <Card title="Quyền truy cập & Chính sách mô hình" icon="shield">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-text-muted">Chính sách áp dụng: </span>
              <span className="font-semibold text-primary">{policyDesc.summary}</span>
            </div>
            {onDismiss && (
              <Button variant="secondary" size="sm" onClick={onDismiss}>
                Đóng hướng dẫn
              </Button>
            )}
          </div>
          {policyDesc.rules.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {policyDesc.details.map((item, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-md bg-surface-2 border border-border text-xs text-text-muted"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Quick Copy Toolbar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface p-3 rounded-xl border border-border flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-text-muted font-medium">Base URL</div>
            <div className="text-xs font-mono text-primary truncate" title={safeQuickBaseUrl || undefined}>
              {safeQuickBaseUrl || "—"}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => safeQuickBaseUrl && copyText(safeQuickBaseUrl, "quickBaseUrl")}
            disabled={!safeQuickBaseUrl}
            className="shrink-0"
          >
            <span className="material-symbols-outlined text-[16px] mr-1">
              {copiedField === "quickBaseUrl" ? "check" : "content_copy"}
            </span>
            {copiedField === "quickBaseUrl" ? "Đã chép" : "Chép"}
          </Button>
        </div>

        <div className="bg-surface p-3 rounded-xl border border-border flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-text-muted font-medium">API Key</div>
            <div className="text-xs font-mono text-primary truncate">
              {maskedApiKey}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copyText(apiKey, "quickApiKey")}
            disabled={!apiKey}
            className="shrink-0"
          >
            <span className="material-symbols-outlined text-[16px] mr-1">
              {copiedField === "quickApiKey" ? "check" : "content_copy"}
            </span>
            {copiedField === "quickApiKey" ? "Đã chép" : "Chép"}
          </Button>
        </div>

        {/* 1-Click Antigravity Client Download Banner */}
        <div className="bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-purple-900/40 p-3.5 rounded-xl border border-indigo-500/30 flex items-center justify-between gap-3 shadow-md">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
              <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
              Bộ cài đặt Antigravity IDE (1-Click Client)
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              Tải tool kết nối tự động, mở lên là chat được ngay trong Antigravity IDE.
            </div>
          </div>
          <a
            href="/downloads/AiNoName-Client.zip"
            download="AiNoName-Client.zip"
            className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-lg hover:shadow-indigo-500/20"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Tải Tool (.zip)
          </a>
        </div>

        <div className="bg-surface p-3 rounded-xl border border-border flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-text-muted font-medium">Model ID</div>
            <div className="text-xs font-mono text-primary truncate" title={selectedModel || "Chưa chọn"}>
              {selectedModel || "—"}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copyText(selectedModel, "quickModel")}
            disabled={!selectedModel}
            className="shrink-0"
          >
            <span className="material-symbols-outlined text-[16px] mr-1">
              {copiedField === "quickModel" ? "check" : "content_copy"}
            </span>
            {copiedField === "quickModel" ? "Đã chép" : "Chép"}
          </Button>
        </div>
      </div>

      {/* Model Selector & Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface p-4 rounded-xl border border-border">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <label className="text-sm font-medium text-text-muted whitespace-nowrap">
            Mô hình cấu hình:
          </label>
          {loadingModels ? (
            <span className="text-xs text-text-muted animate-pulse">Đang tải mô hình...</span>
          ) : (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={loadingModels || models.length === 0}
              className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-primary font-semibold focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-72"
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopyMarkdown}
            disabled={!isSelectionValid}
          >
            <span className="material-symbols-outlined text-[16px] mr-1">
              {copiedField === "fullMarkdown" ? "check" : "content_copy"}
            </span>
            {copiedField === "fullMarkdown" ? "Đã chép Markdown" : "Sao chép Markdown"}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleDownloadMarkdown}
            disabled={!isSelectionValid}
          >
            <span className="material-symbols-outlined text-[16px] mr-1">download</span>
            Tải file .md
          </Button>
        </div>
      </div>

      {copyError && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 text-xs flex items-center justify-between">
          <span>{copyError}</span>
          <button
            onClick={() => setCopyError(null)}
            className="text-red-500 hover:underline cursor-pointer ml-2"
          >
            Đóng
          </button>
        </div>
      )}

      {snippetError && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 text-xs flex items-center gap-2">
          <span className="material-symbols-outlined text-sm shrink-0">error</span>
          <span>{snippetError}</span>
        </div>
      )}

      {/* Integration Guides Sections - Collapsed by default */}
      {snippets && (
        <details className="group border border-border rounded-xl bg-surface p-4 space-y-4">
          <summary className="font-medium text-sm text-text-main cursor-pointer select-none flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-base">integration_instructions</span>
              <span>Hiện hướng dẫn kết nối</span>
            </span>
            <span className="material-symbols-outlined text-sm text-text-muted transition-transform group-open:rotate-180">
              expand_more
            </span>
          </summary>
          <div className="space-y-4 pt-3 border-t border-border/60">
            <div className="flex gap-2 border-b border-border/60 pb-3 flex-wrap">
            <button
              onClick={() => setGuideSection("ide")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                (guideSection === "ide" || (guideSection === "codex" && !snippets.isCodex))
                  ? "bg-surface-2 text-primary border border-border"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Cursor & IDEs
            </button>
            {snippets.isCodex && (
              <button
                onClick={() => setGuideSection("codex")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  guideSection === "codex"
                    ? "bg-surface-2 text-primary border border-border"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                Codex CLI & App
              </button>
            )}
            <button
              onClick={() => setGuideSection("sdk")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                guideSection === "sdk"
                  ? "bg-surface-2 text-primary border border-border"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Python & Node.js SDK
            </button>
            <button
              onClick={() => setGuideSection("curl")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                guideSection === "curl"
                  ? "bg-surface-2 text-primary border border-border"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              Quick Test (cURL)
            </button>
          </div>

          {(guideSection === "ide" || (guideSection === "codex" && !snippets.isCodex)) && (
            <Card title="Cấu hình Cursor / Windsurf / Cline / RooCode" icon="terminal">
              <div className="space-y-4 text-sm text-text-muted mt-2">
                <ol className="list-decimal pl-5 space-y-2">
                  <li>
                    Mở cài đặt của công cụ -&gt; Chọn <strong>Models</strong> hoặc{" "}
                    <strong>API Provider</strong>.
                  </li>
                  <li>
                    Chọn loại Provider: <strong>OpenAI Compatible</strong>.
                  </li>
                  <li>
                    Điền thông số kết nối:
                    <ul className="list-disc pl-5 mt-1 space-y-1 font-mono text-xs">
                      <li>Base URL: <span className="text-primary">{snippets.baseUrl}</span></li>
                      <li>API Key: <span className="text-primary">{snippets.keyToUse}</span></li>
                      <li>Model ID: <span className="text-primary">{snippets.model}</span></li>
                    </ul>
                  </li>
                </ol>
              </div>
            </Card>
          )}

          {guideSection === "codex" && snippets.isCodex && (
            <div className="space-y-4">
              <Card title="Cấu hình Codex CLI & Desktop App" icon="terminal">
                <div className="space-y-4 text-sm text-text-muted mt-2">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold text-text-main">
                        Hợp nhất vào ~/.codex/config.toml (Windows: %USERPROFILE%\.codex\config.toml, hoặc $CODEX_HOME/config.toml):
                      </span>
                      <button
                        onClick={() => copyText(snippets.codexToml, "codexToml")}
                        className="text-xs text-primary hover:underline cursor-pointer"
                      >
                        {copiedField === "codexToml" ? "Đã sao chép!" : "Sao chép TOML"}
                      </button>
                    </div>
                    <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
                      {snippets.codexToml}
                    </pre>
                  </div>

                  <details className="group p-3.5 rounded-lg bg-surface-2 border border-border text-xs text-text-muted space-y-2">
                    <summary className="font-semibold text-text-main cursor-pointer select-none flex items-center justify-between">
                      <span>Lưu ý quan trọng &amp; Hướng dẫn định tuyến (Admin / Routing Notes)</span>
                      <span className="material-symbols-outlined text-sm transition-transform group-open:rotate-180">expand_more</span>
                    </summary>
                    <ul className="list-disc pl-4 space-y-1 pt-2">
                      <li>
                        <strong>Phân biệt Codex Client vs Nhà cung cấp / Mô hình thực tế:</strong> Codex CLI &amp; Desktop App là phần mềm máy khách của OpenAI, kết nối qua giao thức Responses API (<code className="text-primary font-mono">{`wire_api = "responses"`}</code>). Mô hình cấu hình (<code className="text-primary font-mono">{snippets.model}</code>) là tên định danh công khai gửi tới gateway; AI Gateway có thể chuyển đổi giao thức và định tuyến tới các mô hình khác (như Google/AntiGravity Gemini, Anthropic Claude, hoặc các mô hình dự phòng / kết hợp) khi được cấp phép, chứ không giới hạn ở OpenAI GPT.
                      </li>
                      <li>
                        <strong>Lưu ý về bí danh &amp; combo:</strong> Tên mô hình công khai (ví dụ minh họa: <code className="text-primary font-mono">gpt-5.5</code>) có thể được gateway định tuyến dưới dạng bí danh (alias) hoặc bộ kết hợp (combo) trỏ tới mô hình Gemini của Google / AntiGravity (như <code className="text-primary font-mono">ag/gemini-3.8-flash-high</code>, <code className="text-primary font-mono">gemini-2.5-flash</code>...) hoặc nhà cung cấp khác tùy theo cấu hình hệ thống. Tên gọi này là một ví dụ minh họa về khả năng định tuyến theo cấu hình và không phải là sự đảm bảo rằng yêu cầu sẽ luôn được xử lý bởi OpenAI GPT.
                      </li>
                      <li>
                        <strong>Định tuyến tại thời điểm thực thi (Runtime Routing):</strong> Đường dẫn thực tế xử lý yêu cầu được gateway quyết định linh hoạt tại thời điểm thực thi dựa trên tính khả dụng của tài khoản và quy tắc định tuyến của gateway.
                      </li>
                      <li>
                        <strong>Quy định cấp phép đích dự phòng:</strong> Đối với mô hình combo hoặc có chuỗi fallback, <strong>tất cả</strong> các mô hình đích dự phòng (fallback targets) đều phải nằm trong danh mục mô hình được cấp phép của khóa (chính sách <code className="text-primary font-mono">model_policy</code>).
                      </li>
                      <li>
                        <strong>Tái xác thực khi combo thay đổi trong tương lai:</strong> Nếu cấu hình định tuyến combo thay đổi trong tương lai (bổ sung/thay đổi đích mới), các yêu cầu tiếp theo sẽ tự động được kiểm tra lại quyền truy cập; nếu đích mới không nằm trong chính sách cấp phép của khóa, yêu cầu sẽ bị từ chối (<code className="text-primary font-mono">403 model_not_allowed</code>).
                      </li>
                      <li>
                        <strong>Lệnh /status không phải bằng chứng mô hình thực tế:</strong> Lệnh <code className="text-primary font-mono">/status</code> trong Codex CLI chỉ hiển thị tên mô hình công khai đã cấu hình trong <code className="text-primary font-mono">config.toml</code> (hoặc phản hồi danh nghĩa); đây <strong>không phải là bằng chứng</strong> xác nhận mô hình hay nhà cung cấp thực tế đang chạy ở thượng nguồn (actual upstream).
                      </li>
                      <li>
                        <strong>Kiểm tra Combos vs Tuyến thực thi thực tế (Usage / Key Request Log):</strong> Để xem danh sách các đích cấu hình, kiểm tra mục <strong>Combos</strong> trên Dashboard (<code className="text-primary font-mono">configured targets</code>). Để kiểm tra tuyến định tuyến thực tế được chọn khi thực thi, xem thông tin <strong>Actual model</strong> trong nhật ký yêu cầu (Usage / client key request log) hoặc các header phản hồi của gateway như <code className="text-primary font-mono">x-9r-actual-model</code> (mô hình gateway phân giải) và <code className="text-primary font-mono">x-9r-actual-provider</code> (nhà cung cấp chuẩn hóa). Lưu ý: Tuyến phân giải phản ánh quyết định định tuyến của gateway tại thời điểm thực thi, không phải là cam kết mã định danh luồng trực tiếp (exact upstream wireID) do registry của nhà cung cấp có thể có cơ chế ánh xạ phiên bản động (dynamic mapping).
                      </li>
                      <li>
                        <strong>Không cam kết tương đương tính năng nếu chưa kiểm thử:</strong> Giao thức Responses API cung cấp kết nối nhưng không cam kết tương đương 100% tính năng (gọi công cụ / tool calling, streaming nâng cao, reasoning...) giữa các nhà cung cấp khác nhau khi chưa có kiểm thử độc lập. Người dùng nên tự kiểm chứng trên công cụ của mình.
                      </li>
                      <li>
                        <strong>Hợp nhất tệp thủ công:</strong> Hợp nhất (merge) nội dung cấu hình vào tệp hiện có của bạn, không tạo trùng lặp bảng hoặc khóa. Đặt các trường <code className="text-primary font-mono">model</code> và <code className="text-primary font-mono">model_provider</code> ở phần đầu, trước bảng TOML đầu tiên. Vui lòng sao lưu trước khi chỉnh sửa. Không tự động thực thi tệp.
                      </li>
                      <li>
                        <strong>Vị trí tệp config.toml:</strong> Tệp nằm tại <code className="text-primary font-mono">~/.codex/config.toml</code> (macOS/Linux/WSL) hoặc <code className="text-primary font-mono">%USERPROFILE%\.codex\config.toml</code> (Windows), hoặc <code className="text-primary font-mono">$CODEX_HOME/config.toml</code> nếu CODEX_HOME được thiết lập.
                      </li>
                      <li>
                        <strong>Dùng chung cấu hình giữa CLI và Desktop App:</strong> Codex CLI và Desktop App đọc chung tệp cấu hình. Khởi động lại ứng dụng sau khi cập nhật tệp cấu hình.
                      </li>
                      <li>
                        <strong>Metadata danh mục:</strong> Các định danh hoặc bí danh tùy chỉnh (như tiền tố <code className="text-primary font-mono">cx/</code>) có thể cần metadata danh mục (catalog) Codex khớp với mô hình và phiên bản Codex đã cài đặt (do quản trị viên cung cấp), không phải danh sách <code className="text-primary font-mono">/v1/models</code> thông thường. Không tự ý cấu hình hoặc chỉ định đường dẫn catalog nếu chưa được cung cấp.
                      </li>
                      <li>
                        Tài liệu chính thức: <a href="https://developers.openai.com/codex/enterprise/connect-to-a-gateway.md" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">https://developers.openai.com/codex/enterprise/connect-to-a-gateway.md</a>
                      </li>
                    </ul>
                  </details>
                </div>
              </Card>
            </div>
          )}

          {guideSection === "sdk" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card title="Python (OpenAI SDK)" icon="code">
                <div className="space-y-2 mt-2">
                  <div className="flex justify-end">
                    <button
                      onClick={() => copyText(snippets.pythonSdk, "pythonSdk")}
                      className="text-xs text-primary hover:underline"
                    >
                      {copiedField === "pythonSdk" ? "Đã sao chép!" : "Sao chép code"}
                    </button>
                  </div>
                  <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
                    {snippets.pythonSdk}
                  </pre>
                </div>
              </Card>

              <Card title="Node.js (OpenAI SDK)" icon="code">
                <div className="space-y-2 mt-2">
                  <div className="flex justify-end">
                    <button
                      onClick={() => copyText(snippets.nodeSdk, "nodeSdk")}
                      className="text-xs text-primary hover:underline"
                    >
                      {copiedField === "nodeSdk" ? "Đã sao chép!" : "Sao chép code"}
                    </button>
                  </div>
                  <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
                    {snippets.nodeSdk}
                  </pre>
                </div>
              </Card>
            </div>
          )}

          {guideSection === "curl" && (
            <Card title="Kiểm tra kết nối nhanh (cURL)" icon="terminal">
              <div className="space-y-2 mt-2">
                <div className="flex justify-end">
                  <button
                    onClick={() => copyText(snippets.curlChat, "curlChat")}
                    className="text-xs text-primary hover:underline"
                  >
                    {copiedField === "curlChat" ? "Đã sao chép!" : "Sao chép lệnh"}
                  </button>
                </div>
                <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
                  {snippets.curlChat}
                </pre>
              </div>
            </Card>
          )}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Keyed wrapper to guarantee immediate identity safety and clean state teardown.
 * Synchronously resets state on key/origin/policy change without leaking old state.
 */
export default function ClientKeyGuide(props) {
  const { apiKey = "", apiOrigin = "", keyData } = props;
  const effectiveApiKey = apiKey || keyData?.key || "";
  const policyKey = JSON.stringify(keyData?.model_policy ?? null);
  const instanceKey = `${effectiveApiKey}::${apiOrigin}::${policyKey}`;

  return <ClientKeyGuideInner key={instanceKey} {...props} apiKey={effectiveApiKey} />;
}
