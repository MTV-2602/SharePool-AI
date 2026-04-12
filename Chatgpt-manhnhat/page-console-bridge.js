(() => {
  if (window.__afAutoSubConsoleBridgeInstalled) return;

  const href = String(window.location.href || '');
  const isCheckout = /checkout/i.test(href);

  if (!isCheckout) return;

  window.__afAutoSubConsoleBridgeInstalled = true;

  const EVENT_NAME = 'af-auto-sub-console-signal';
  const PATTERN = /failed to process stripe checkout|unable to authenticate your payment method|authentication failed|card has been declined|your card was declined|payment failed|could not be processed|try another payment method|paymentFailed|generic_decline|insufficient_funds|do_not_honor|card_declined/i;

  // Chỉ lấy text thuần, KHÔNG JSON.stringify object (tránh DataDog 3KiB)
  function safeText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Error) return value.message || '';
    // Với object: chỉ lấy .message hoặc .error nếu có, không serialize toàn bộ
    if (typeof value === 'object') {
      return String(value.message || value.error || value.code || '');
    }
    return '';
  }

  function emit(args) {
    // Giới hạn 200 ký tự để không bao giờ vượt DataDog 3KiB threshold
    const text = args.map(safeText).filter(Boolean).join(' ').slice(0, 200);
    if (!text || !PATTERN.test(text)) return;
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {
      detail: { message: text }
    }));
  }

  for (const level of ['error', 'warn']) {
    const original = console[level];
    console[level] = function(...args) {
      try { emit(args); } catch (_) {}
      return original.apply(this, args);
    };
  }
})();
